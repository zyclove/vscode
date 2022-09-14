/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFooService } from 'vs/workbench/contrib/foo/common/foo';

export class FooService implements IFooService {
	bar() {
		console.log('FooService.bar called');
	}
}
