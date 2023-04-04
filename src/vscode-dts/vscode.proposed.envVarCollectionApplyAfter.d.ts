/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface EnvironmentVariableCollection extends Iterable<[variable: string, mutator: EnvironmentVariableMutator]> {
		/**
		 * Whether the collection should attempt to re-apply the _replace_ environment variable
		 * mutators after the shell initialization scripts have been run. This is useful if it's
		 * likely a shell init script may overwrite important environment variables to the
		 * extension. Before using this, consider whether the user would expect this overriding of
		 * their shell startup behavior. Defaults to false.
		 *
		 * This works by passing the environment changes through to the shell integration scripts
		 * via the `VSCODE_REAPPLY_ENV` variable. The environment variable will be set on terminals
		 * regardless of whether automatic injection of shell integration is enabled, if shell
		 * integration does not activate the variable will _not_ be unset.
		 */
		reapplyAfterInit: boolean;
	}
}
