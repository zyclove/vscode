/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import type { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import type { IAsyncContribContext } from 'vs/workbench/contrib/foo/common/contribContext';

export class ContribContextContribution implements IWorkbenchContribution {
	constructor(
		instantiationService: IInstantiationService,
		ctx: IAsyncContribContext,
	) {
		const injected1 = new ctx.lifecycle.DisposableStore();
		const injected2 = new ctx.event.Emitter();

		console.log('ContribContextContribution.ctor', { injected1, injected2 }, instantiationService);
	}
}
