/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { makeUniversalApp } from 'vscode-universal-bundler';
import { spawn } from '@malept/cross-spawn-promise';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as product from '../../product.json';

async function main() {
	const buildDir = process.env['AGENT_BUILDDIRECTORY'];
	const arch = process.env['VSCODE_ARCH'];

	if (!buildDir) {
		throw new Error('$AGENT_BUILDDIRECTORY not set');
	}

	const appName = product.nameLong + '.app';
	const x64AppPath = path.join(buildDir, 'VSCode-darwin-x64', appName);
	const arm64AppPath = path.join(buildDir, 'VSCode-darwin-arm64', appName);
	const asarPath = path.join('Contents', 'Resources', 'app', 'node_modules.asar');
	const outAppPath = path.join(buildDir, `VSCode-darwin-${arch}`, appName);
	const productJsonPath = path.resolve(outAppPath, 'Contents', 'Resources', 'app', 'product.json');

	await makeUniversalApp({
		x64AppPath,
		arm64AppPath,
		asarPath,
		outAppPath,
		force: true,
		mergeASARs: true,
		singleArchFiles: '@(README.md~|LICENSE)',
		filesToSkipComparison: (file: string) => {
			const basename = path.basename(file);
			return ['debug.js',
					'package.json',
					'CodeResources',
					'MainMenu.nib',
					'Credits.rtf',
					'product.json'].includes(basename) ||
					file.startsWith('emoji-regex') ||
					file.startsWith('node-gyp') ||
					file.startsWith('es6-promise');
		}
	});

	let productJson = await fs.readJson(productJsonPath);
	Object.assign(productJson, {
		darwinUniversalAssetId: 'darwin-universal'
	});
	await fs.writeJson(productJsonPath, productJson);

	// Verify if native module architecture is correct
	const findOutput = await spawn('find', [outAppPath, '-name', 'keytar.node']);
	const lipoOutput = await spawn('lipo', ['-archs', findOutput.replace(/\n$/, '')]);
	if (lipoOutput.replace(/\n$/, '') !== 'x86_64 arm64') {
		throw new Error(`Invalid arch, got : ${lipoOutput}`);
	}
}

if (require.main === module) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
