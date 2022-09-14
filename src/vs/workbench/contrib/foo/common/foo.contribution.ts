/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';

// Workbench contributions:
class AsyncFooWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		// Types of the imported file are pulled in correctly
		import('vs/workbench/contrib/foo/common/fooWorkbenchContribution' as any).then(e => {
			instantiationService.createInstance(e.FooContribution);
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(AsyncFooWorkbenchContribution, 'FooWorkbenchContribution', LifecyclePhase.Restored);
