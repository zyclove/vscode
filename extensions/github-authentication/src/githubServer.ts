/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { PromiseAdapter, promiseFromEvent } from './common/utils';
import { ExperimentationTelemetry } from './common/experimentationService';
import { AuthProviderType, UriEventHandler } from './github';
import { Log } from './common/logger';
import { fetching } from './node/fetch';

const GITHUB_TOKEN_URL = 'https://vscode.dev/codeExchangeProxyEndpoints/github/login/oauth/access_token';
const NETWORK_ERROR = 'network error';

const REDIRECT_URL_STABLE = 'https://vscode.dev/redirect';
const REDIRECT_URL_INSIDERS = 'https://insiders.vscode.dev/redirect';

export interface IGitHubServer {
	login(scopes: string): Promise<string>;
	getUserInfo(token: string): Promise<{ id: string; accountName: string }>;
	sendAdditionalTelemetryInfo(token: string): Promise<void>;
	friendlyName: string;
}

async function getScopes(token: string, serverUri: vscode.Uri, logger: Log): Promise<string[]> {
	try {
		logger.info('Getting token scopes...');
		const result = await fetching(serverUri.toString(), {
			headers: {
				Authorization: `token ${token}`,
				'User-Agent': 'Visual-Studio-Code'
			}
		});

		if (result.ok) {
			const scopes = result.headers.get('X-OAuth-Scopes');
			return scopes ? scopes.split(',').map(scope => scope.trim()) : [];
		} else {
			logger.error(`Getting scopes failed: ${result.statusText}`);
			throw new Error(result.statusText);
		}
	} catch (ex) {
		logger.error(ex.message);
		throw new Error(NETWORK_ERROR);
	}
}

export abstract class AbstractGitHubServer implements IGitHubServer {
	protected static readonly _clientId = '01ab8ac9400c4e429b23';
	protected static readonly _mediaPath = path.join(__dirname, '../media');

	readonly friendlyName: string;

	private readonly _pendingNonces = new Map<string, string[]>();
	private readonly _codeExchangePromises = new Map<string, { promise: Promise<string>; cancel: vscode.EventEmitter<void> }>();

	protected readonly _type: AuthProviderType;

	private _redirectEndpoint: string | undefined;

	constructor(
		protected readonly _logger: Log,
		protected readonly _telemetryReporter: ExperimentationTelemetry,
		protected readonly _uriHandler: UriEventHandler,
		protected readonly _extensionKind: vscode.ExtensionKind,
		protected readonly _ghesUri?: vscode.Uri
	) {
		this._type = _ghesUri ? AuthProviderType.githubEnterprise : AuthProviderType.github;
		this.friendlyName = this._type === AuthProviderType.github ? 'GitHub' : _ghesUri?.authority!;
	}

	//#region Abstract

	abstract sendAdditionalTelemetryInfo(token: string): Promise<void>;
	abstract login(scopes: string): Promise<string>;

	//#endregion

	//#region Public

	get baseUri() {
		if (this._type === AuthProviderType.github) {
			return vscode.Uri.parse('https://github.com/');
		}
		return this._ghesUri!;
	}

	public async getUserInfo(token: string): Promise<{ id: string; accountName: string }> {
		let result;
		try {
			this._logger.info('Getting user info...');
			result = await fetching(this.getServerUri('/user').toString(), {
				headers: {
					Authorization: `token ${token}`,
					'User-Agent': 'Visual-Studio-Code'
				}
			});
		} catch (ex) {
			this._logger.error(ex.message);
			throw new Error(NETWORK_ERROR);
		}

		if (result.ok) {
			try {
				const json = await result.json();
				this._logger.info('Got account info!');
				return { id: json.id, accountName: json.login };
			} catch (e) {
				this._logger.error(`Unexpected error parsing response from GitHub: ${e.message ?? e}`);
				throw e;
			}
		} else {
			// either display the response message or the http status text
			let errorMessage = result.statusText;
			try {
				const json = await result.json();
				if (json.message) {
					errorMessage = json.message;
				}
			} catch (err) {
				// noop
			}
			this._logger.error(`Getting account info failed: ${errorMessage}`);
			throw new Error(errorMessage);
		}
	}

	//#endregion

	//#region Login

	protected async doLoginWithoutLocalServer(scopes: string, nonce: string, callbackUri: vscode.Uri): Promise<string> {
		this._logger.info(`Trying without local server... (${scopes})`);
		return await vscode.window.withProgress<string>({
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t({
				message: 'Signing in to {0}...',
				args: [this.baseUri.authority],
				comment: ['The {0} will be a url, e.g. github.com']
			}),
			cancellable: true
		}, async (_, token) => {
			const existingNonces = this._pendingNonces.get(scopes) || [];
			this._pendingNonces.set(scopes, [...existingNonces, nonce]);
			const redirectUri = await this.getRedirectEndpoint();
			const searchParams = new URLSearchParams([
				['client_id', AbstractGitHubServer._clientId],
				['redirect_uri', redirectUri],
				['scope', scopes],
				['state', encodeURIComponent(callbackUri.toString(true))]
			]);

			const uri = vscode.Uri.parse(this.baseUri.with({
				path: '/login/oauth/authorize',
				query: searchParams.toString()
			}).toString(true));
			await vscode.env.openExternal(uri);

			// Register a single listener for the URI callback, in case the user starts the login process multiple times
			// before completing it.
			let codeExchangePromise = this._codeExchangePromises.get(scopes);
			if (!codeExchangePromise) {
				codeExchangePromise = promiseFromEvent(this._uriHandler!.event, this.handleUri(scopes));
				this._codeExchangePromises.set(scopes, codeExchangePromise);
			}

			try {
				return await Promise.race([
					codeExchangePromise.promise,
					new Promise<string>((_, reject) => setTimeout(() => reject('Timed out'), 300_000)), // 5min timeout
					promiseFromEvent<any, any>(token.onCancellationRequested, (_, __, reject) => { reject('User Cancelled'); }).promise
				]);
			} finally {
				this._pendingNonces.delete(scopes);
				codeExchangePromise?.cancel.fire();
				this._codeExchangePromises.delete(scopes);
			}
		});
	}

	protected async doLoginWithPat(scopes: string): Promise<string> {
		this._logger.info(`Trying to retrieve PAT... (${scopes})`);

		const button = vscode.l10n.t('Continue to GitHub');
		const modalResult = await vscode.window.showInformationMessage(
			vscode.l10n.t('Continue to GitHub to create a Personal Access Token (PAT)'),
			{
				modal: true,
				detail: vscode.l10n.t('To finish authenticating, navigate to GitHub to create a PAT then paste the PAT into the input box.')
			}, button);

		if (modalResult !== button) {
			throw new Error('User Cancelled');
		}

		const description = `${vscode.env.appName} (${scopes})`;
		const uriToOpen = await vscode.env.asExternalUri(this.baseUri.with({ path: '/settings/tokens/new', query: `description=${description}&scopes=${scopes.split(' ').join(',')}` }));
		await vscode.env.openExternal(uriToOpen);
		const token = await vscode.window.showInputBox({ placeHolder: `ghp_1a2b3c4...`, prompt: `GitHub Personal Access Token - ${scopes}`, ignoreFocusOut: true });
		if (!token) { throw new Error('User Cancelled'); }

		const tokenScopes = await getScopes(token, this.getServerUri('/'), this._logger); // Example: ['repo', 'user']
		const scopesList = scopes.split(' '); // Example: 'read:user repo user:email'
		if (!scopesList.every(scope => {
			const included = tokenScopes.includes(scope);
			if (included || !scope.includes(':')) {
				return included;
			}

			return scope.split(':').some(splitScopes => {
				return tokenScopes.includes(splitScopes);
			});
		})) {
			throw new Error(`The provided token does not match the requested scopes: ${scopes}`);
		}

		return token;
	}

	//#endregion

	//#region Protected

	protected async getRedirectEndpoint(): Promise<string> {
		if (this._redirectEndpoint) {
			return this._redirectEndpoint;
		}
		if (this._type === AuthProviderType.github) {
			const proxyEndpoints = await vscode.commands.executeCommand<{ [providerId: string]: string } | undefined>('workbench.getCodeExchangeProxyEndpoints');
			// If we are running in insiders vscode.dev, then ensure we use the redirect route on that.
			this._redirectEndpoint = REDIRECT_URL_STABLE;
			if (proxyEndpoints?.github && new URL(proxyEndpoints.github).hostname === 'insiders.vscode.dev') {
				this._redirectEndpoint = REDIRECT_URL_INSIDERS;
			}
			return this._redirectEndpoint;
		} else {
			// GHES
			const result = await fetching(this.getServerUri('/meta').toString(true));
			if (result.ok) {
				try {
					const json: { installed_version: string } = await result.json();
					const [majorStr, minorStr, _patch] = json.installed_version.split('.');
					const major = Number(majorStr);
					const minor = Number(minorStr);
					if (major >= 4 || major === 3 && minor >= 8
					) {
						// GHES 3.8 and above used vscode.dev/redirect as the route.
						// It only supports a single redirect endpoint, so we can't use
						// insiders.vscode.dev/redirect when we're running in Insiders, unfortunately.
						this._redirectEndpoint = 'https://vscode.dev/redirect';
					}
				} catch (e) {
					this._logger.error(e);
				}
			}

			// TODO in like 1 year change the default vscode.dev/redirect maybe
			this._redirectEndpoint = 'https://vscode-auth.github.com/';
		}
		return this._redirectEndpoint;
	}

	protected async exchangeCodeForToken(code: string): Promise<string> {
		this._logger.info('Exchanging code for token...');

		const proxyEndpoints: { [providerId: string]: string } | undefined = await vscode.commands.executeCommand('workbench.getCodeExchangeProxyEndpoints');
		const endpointUrl = proxyEndpoints?.github ? `${proxyEndpoints.github}login/oauth/access_token` : GITHUB_TOKEN_URL;

		const body = new URLSearchParams([['code', code]]);
		if (this._type === AuthProviderType.githubEnterprise) {
			body.append('github_enterprise', this.baseUri.toString(true));
			body.append('redirect_uri', await this.getRedirectEndpoint());
		}
		const result = await fetching(endpointUrl, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
				'Content-Length': body.toString()

			},
			body: body.toString()
		});

		if (result.ok) {
			const json = await result.json();
			this._logger.info('Token exchange success!');
			return json.access_token;
		} else {
			const text = await result.text();
			const error = new Error(text);
			error.name = 'GitHubTokenExchangeError';
			throw error;
		}
	}

	protected getServerUri(path: string = '') {
		if (this._type === AuthProviderType.github) {
			return vscode.Uri.parse('https://api.github.com').with({ path });
		}
		// GHES
		const apiUri = this.baseUri;
		return vscode.Uri.parse(`${apiUri.scheme}://${apiUri.authority}/api/v3${path}`);
	}

	//#endregion

	private handleUri: (scopes: string) => PromiseAdapter<vscode.Uri, string> =
		(scopes) => (uri, resolve, reject) => {
			const query = new URLSearchParams(uri.query);
			const code = query.get('code');
			const nonce = query.get('nonce');
			if (!code) {
				reject(new Error('No code'));
				return;
			}
			if (!nonce) {
				reject(new Error('No nonce'));
				return;
			}

			const acceptedNonces = this._pendingNonces.get(scopes) || [];
			if (!acceptedNonces.includes(nonce)) {
				// A common scenario of this happening is if you:
				// 1. Trigger a sign in with one set of scopes
				// 2. Before finishing 1, you trigger a sign in with a different set of scopes
				// In this scenario we should just return and wait for the next UriHandler event
				// to run as we are probably still waiting on the user to hit 'Continue'
				this._logger.info('Nonce not found in accepted nonces. Skipping this execution...');
				return;
			}

			resolve(this.exchangeCodeForToken(code));
		};
}
