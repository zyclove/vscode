/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { env, Uri } from 'vscode';
import { AbstractGitHubServer } from '../githubServer';
import { crypto } from '../browser/crypto';
import { isSupportedEnvironment } from '../common/env';

export class GitHubServer extends AbstractGitHubServer {

	public async login(scopes: string): Promise<string> {
		const nonce: string = crypto.getRandomValues(new Uint32Array(2)).reduce((prev, curr) => prev += curr.toString(16), '');
		const callbackUri = await env.asExternalUri(Uri.parse(`${env.uriScheme}://github-authentication/did-authenticate?nonce=${encodeURIComponent(nonce)}`));
		const supported = isSupportedEnvironment(callbackUri);

		if (supported) {
			try {
				return await this.doLoginWithoutLocalServer(scopes, nonce, callbackUri);
			} catch (e) {
				this._logger.error(e);
				throw new Error(e.message ?? e === 'User Cancelled' ? 'Cancelled' : 'No auth flow succeeded.');
			}
		} else {
			try {
				return await this.doLoginWithPat(scopes);
			} catch (e) {
				this._logger.error(e);
				throw new Error(e.message ?? e === 'User Cancelled' ? 'Cancelled' : 'No auth flow succeeded.');
			}
		}
	}

	public sendAdditionalTelemetryInfo(_token: string): Promise<void> {
		// noop since GitHub EDU does not have CORS set up properly
		// to allow us to use their APIs.
		// Once they do, then the sendAdditionalTelemetryInfo in Node can be used.
		return Promise.resolve();
	}
}

// GitHub Enterprise isn't really supported on the web yet. Since there's no way to open a virtual GHES repo.
// In any case, we have these as best effort if somehow someone is able to open a GHES repo on the web.

export class SimpleGitHubEnterpriseServer extends GitHubServer { }

export class InternetAvailableGitHubEnterpriseServer extends GitHubServer { }
