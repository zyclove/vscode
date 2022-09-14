/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import type { IWorkbenchContribution } from 'vs/workbench/common/contributions';

export class SharedBundleContribution implements IWorkbenchContribution {
	constructor(
		// TODO: Can dependency injection be supported with dynamic imports?
		//       Does it need a special separate decorator?
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		console.log('SharedBundleContribution init', instantiationService);
	}
}
