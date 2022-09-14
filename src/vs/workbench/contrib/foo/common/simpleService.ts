/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISimpleService } from 'vs/workbench/contrib/foo/common/simple';

export class SimpleService implements ISimpleService {
	bar() {
		console.log('FooService.bar called');
	}
}
