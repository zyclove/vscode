/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export class FooContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		console.log('foo contribution init', instantiationService);
	}
}
