/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { env, ExtensionKind, l10n, ProgressLocation, Uri, window } from 'vscode';
import { isSupportedEnvironment } from '../common/env';
import { AbstractGitHubServer } from '../githubServer';
import { promiseFromEvent } from '../common/utils';
import { LoopbackAuthServer } from './authServer';
import { fetching } from './fetch';
import { crypto } from './crypto';

interface IGitHubDeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	interval: number;
}

abstract class AbstractNodeGitHubServer extends AbstractGitHubServer {
	// must be reset in every login call
	protected userCancelled: boolean | undefined;

	// Used for showing a friendlier message to the user when the explicitly cancel a flow.
	protected async promptToContinue() {
		const yes = l10n.t('Yes');
		const no = l10n.t('No');
		if (this.userCancelled === undefined) {
			// We haven't had a failure yet so wait to prompt
			return;
		}
		const message = this.userCancelled
			? l10n.t('Having trouble logging in? Would you like to try a different way?')
			: l10n.t('You have not yet finished authorizing this extension to use GitHub. Would you like to keep trying?');
		const result = await window.showWarningMessage(message, yes, no);
		if (result !== yes) {
			throw new Error('Cancelled');
		}
	}

	protected async doLoginWithLocalServer(scopes: string): Promise<string> {
		this._logger.info(`Trying with local server... (${scopes})`);
		return await window.withProgress<string>({
			location: ProgressLocation.Notification,
			title: l10n.t({
				message: 'Signing in to {0}...',
				args: [this.baseUri.authority],
				comment: ['The {0} will be a url, e.g. github.com']
			}),
			cancellable: true
		}, async (_, token) => {
			const redirectUri = await this.getRedirectEndpoint();
			const searchParams = new URLSearchParams([
				['client_id', AbstractNodeGitHubServer._clientId],
				['redirect_uri', redirectUri],
				['scope', scopes],
			]);

			const loginUrl = this.baseUri.with({
				path: '/login/oauth/authorize',
				query: searchParams.toString()
			});
			const server = new LoopbackAuthServer(AbstractNodeGitHubServer._mediaPath, loginUrl.toString(true));
			const port = await server.start();

			let codeToExchange;
			try {
				env.openExternal(Uri.parse(`http://127.0.0.1:${port}/signin?nonce=${encodeURIComponent(server.nonce)}`));
				const { code } = await Promise.race([
					server.waitForOAuthResponse(),
					new Promise<any>((_, reject) => setTimeout(() => reject('Timed out'), 300_000)), // 5min timeout
					promiseFromEvent<any, any>(token.onCancellationRequested, (_, __, reject) => { reject('User Cancelled'); }).promise
				]);
				codeToExchange = code;
			} finally {
				setTimeout(() => {
					void server.stop();
				}, 5000);
			}

			const accessToken = await this.exchangeCodeForToken(codeToExchange);
			return accessToken;
		});
	}

	protected async doLoginDeviceCodeFlow(scopes: string): Promise<string> {
		this._logger.info(`Trying device code flow... (${scopes})`);

		// Get initial device code
		const uri = this.baseUri.with({
			path: '/login/device/code',
			query: `client_id=${AbstractGitHubServer._clientId}&scope=${scopes}`
		});
		const result = await fetching(uri.toString(true), {
			method: 'POST',
			headers: {
				Accept: 'application/json'
			}
		});
		if (!result.ok) {
			throw new Error(`Failed to get one-time code: ${await result.text()}`);
		}

		const json = await result.json() as IGitHubDeviceCodeResponse;

		const button = l10n.t('Copy & Continue to GitHub');
		const modalResult = await window.showInformationMessage(
			l10n.t({ message: 'Your Code: {0}', args: [json.user_code], comment: ['The {0} will be a code, e.g. 123-456'] }),
			{
				modal: true,
				detail: l10n.t('To finish authenticating, navigate to GitHub and paste in the above one-time code.')
			}, button);

		if (modalResult !== button) {
			throw new Error('User Cancelled');
		}

		await env.clipboard.writeText(json.user_code);

		const uriToOpen = await env.asExternalUri(Uri.parse(json.verification_uri));
		await env.openExternal(uriToOpen);

		return await this.waitForDeviceCodeAccessToken(json);
	}

	private async waitForDeviceCodeAccessToken(json: IGitHubDeviceCodeResponse): Promise<string> {
		return await window.withProgress<string>({
			location: ProgressLocation.Notification,
			cancellable: true,
			title: l10n.t({
				message: 'Open [{0}]({0}) in a new tab and paste your one-time code: {1}',
				args: [json.verification_uri, json.user_code],
				comment: [
					'The [{0}]({0}) will be a url and the {1} will be a code, e.g. 123-456',
					'{Locked="[{0}]({0})"}'
				]
			})
		}, async (_, token) => {
			const refreshTokenUri = this.baseUri.with({
				path: '/login/oauth/access_token',
				query: `client_id=${AbstractGitHubServer._clientId}&device_code=${json.device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
			});

			// Try for 2 minutes
			const attempts = 120 / json.interval;
			for (let i = 0; i < attempts; i++) {
				await new Promise(resolve => setTimeout(resolve, json.interval * 1000));
				if (token.isCancellationRequested) {
					throw new Error('User Cancelled');
				}
				let accessTokenResult;
				try {
					accessTokenResult = await fetching(refreshTokenUri.toString(true), {
						method: 'POST',
						headers: {
							Accept: 'application/json'
						}
					});
				} catch {
					continue;
				}

				if (!accessTokenResult.ok) {
					continue;
				}

				const accessTokenJson = await accessTokenResult.json();

				if (accessTokenJson.error === 'authorization_pending') {
					continue;
				}

				if (accessTokenJson.error) {
					throw new Error(accessTokenJson.error_description);
				}

				return accessTokenJson.access_token;
			}

			throw new Error('Cancelled');
		});
	}
}

export class GitHubServer extends AbstractNodeGitHubServer {
	public async login(scopes: string): Promise<string> {
		this.userCancelled = undefined;

		const nonce: string = crypto.getRandomValues(new Uint32Array(2)).reduce((prev, curr) => prev += curr.toString(16), '');
		const callbackUri = await env.asExternalUri(Uri.parse(`${env.uriScheme}://github-authentication/did-authenticate?nonce=${encodeURIComponent(nonce)}`));

		const supported = isSupportedEnvironment(callbackUri);

		if (supported) {
			try {
				return await this.doLoginWithoutLocalServer(scopes, nonce, callbackUri);
			} catch (e) {
				this._logger.error(e);
				this.userCancelled = e.message ?? e === 'User Cancelled';
			}
		}

		// Starting a local server is only supported if:
		// 1. We are in a UI extension because we need to open a port on the machine that has the browser
		// 2. We are in a node runtime because we need to open a port on the machine
		if (this._extensionKind === ExtensionKind.UI) {
			try {
				await this.promptToContinue();
				return await this.doLoginWithLocalServer(scopes);
			} catch (e) {
				this._logger.error(e);
				this.userCancelled = e.message ?? e === 'User Cancelled';
			}
		}

		try {
			await this.promptToContinue();
			return await this.doLoginDeviceCodeFlow(scopes);
		} catch (e) {
			this._logger.error(e);
			this.userCancelled = e.message ?? e === 'User Cancelled';
		}

		// In a supported environment, we can't use PAT auth because we use this auth for Settings Sync and it doesn't support PATs.
		if (!supported) {
			try {
				await this.promptToContinue();
				return await this.doLoginWithPat(scopes);
			} catch (e) {
				this._logger.error(e);
				this.userCancelled = e.message ?? e === 'User Cancelled';
			}
		}

		throw new Error(this.userCancelled ? 'Cancelled' : 'No auth flow succeeded.');
	}

	public async sendAdditionalTelemetryInfo(token: string): Promise<void> {
		if (!env.isTelemetryEnabled) {
			return;
		}

		return await this.checkEduDetails(token);
	}

	private async checkEduDetails(token: string): Promise<void> {
		try {
			const result = await fetching('https://education.github.com/api/user', {
				headers: {
					Authorization: `token ${token}`,
					'faculty-check-preview': 'true',
					'User-Agent': 'Visual-Studio-Code'
				}
			});

			if (result.ok) {
				const json: { student: boolean; faculty: boolean } = await result.json();

				/* __GDPR__
					"session" : {
						"owner": "TylerLeonhardt",
						"isEdu": { "classification": "NonIdentifiableDemographicInfo", "purpose": "FeatureInsight" }
					}
				*/
				this._telemetryReporter.sendTelemetryEvent('session', {
					isEdu: json.student
						? 'student'
						: json.faculty
							? 'faculty'
							: 'none'
				});
			}
		} catch (e) {
			// No-op
		}
	}
}

export class SimpleGitHubEnterpriseServer extends AbstractNodeGitHubServer {
	private _cachedEnterpriseVersion: string | undefined;
	public async login(scopes: string): Promise<string> {
		this.userCancelled = undefined;

		const version = await this.getEnterpriseVersion();
		if (version) {
			const [major, minor, _patch] = version.split('.');
			// Device code flow is only supported on GitHub Enterprise 3.1 and above
			if (major && minor && major >= '3' && minor >= '1') {
				try {
					await this.promptToContinue();
					return await this.doLoginDeviceCodeFlow(scopes);
				} catch (e) {
					this._logger.error(e);
					this.userCancelled = e.message ?? e === 'User Cancelled';
				}
			}
		}

		// Since the user can't use a GHES account with Settings Sync, this can always be a fallback option.
		try {
			await this.promptToContinue();
			return await this.doLoginWithPat(scopes);
		} catch (e) {
			this._logger.error(e);
			this.userCancelled = e.message ?? e === 'User Cancelled';
		}

		throw new Error(this.userCancelled ? 'Cancelled' : 'No auth flow succeeded.');
	}

	public async sendAdditionalTelemetryInfo(_token: string): Promise<void> {
		if (!env.isTelemetryEnabled) {
			return;
		}

		// GHES
		const version = await this.getEnterpriseVersion();
		if (version) {
			/* __GDPR__
				"ghe-session" : {
					"owner": "TylerLeonhardt",
					"version": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this._telemetryReporter.sendTelemetryEvent('ghe-session', {
				version
			});
		}
	}

	private async getEnterpriseVersion(): Promise<string | undefined> {
		if (this._cachedEnterpriseVersion) {
			return this._cachedEnterpriseVersion;
		}
		try {

			const result = await fetching(this.getServerUri('/meta').toString(), {
				headers: {
					'User-Agent': 'Visual-Studio-Code'
				}
			});

			if (!result.ok) {
				return;
			}

			const json: { verifiable_password_authentication: boolean; installed_version: string } = await result.json();
			this._cachedEnterpriseVersion = json.installed_version;
			return this._cachedEnterpriseVersion;
		} catch {
			// No-op
			return;
		}
	}
}

export class InternetAvailableGitHubEnterpriseServer extends SimpleGitHubEnterpriseServer {

	public override async login(scopes: string): Promise<string> {
		this.userCancelled = undefined;

		const nonce: string = crypto.getRandomValues(new Uint32Array(2)).reduce((prev, curr) => prev += curr.toString(16), '');
		const callbackUri = await env.asExternalUri(Uri.parse(`${env.uriScheme}://github-authentication/did-authenticate?nonce=${encodeURIComponent(nonce)}`));

		const supported = isSupportedEnvironment(callbackUri);

		if (supported) {
			try {
				return await this.doLoginWithoutLocalServer(scopes, nonce, callbackUri);
			} catch (e) {
				this._logger.error(e);
				this.userCancelled = e.message ?? e === 'User Cancelled';
			}
		}

		// Starting a local server is only supported if:
		// 1. We are in a UI extension because we need to open a port on the machine that has the browser
		// 2. We are in a node runtime because we need to open a port on the machine
		if (this._extensionKind === ExtensionKind.UI) {
			try {
				await this.promptToContinue();
				return await this.doLoginWithLocalServer(scopes);
			} catch (e) {
				this._logger.error(e);
				this.userCancelled = e.message ?? e === 'User Cancelled';
			}
		}

		return await super.login(scopes);
	}
}
