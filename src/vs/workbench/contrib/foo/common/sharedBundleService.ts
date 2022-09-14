/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ISharedBundleService } from 'vs/workbench/contrib/foo/common/sharedBundle';

export class SharedBundleService implements ISharedBundleService {
	bar() {
		console.log('FooService.bar called');
	}
}
