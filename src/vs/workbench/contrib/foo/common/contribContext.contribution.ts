/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { IAsyncContribContext } from 'vs/workbench/contrib/foo/common/contribContext';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';



//
// A proof of concept for a context object that gets passed around for convenient injection of
// common base or platform bits
//

const asyncContribContext: IAsyncContribContext = {
	event: {
		Emitter
	},
	lifecycle: {
		DisposableStore
	}
};

class AsyncContribContextContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		// Types of the imported file are pulled in correctly
		import('vs/workbench/contrib/foo/common/contribContextWorkbenchContribution').then(e => {
			instantiationService.createInstance(e.ContribContextContribution, asyncContribContext);
		});
	}
}

// TODO: registerAsyncWorkbenchContribution could be used to make AsyncContribContextContribution
//       not needed if IAsyncContribContext became an injectable service
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(AsyncContribContextContribution, 'ContribContextContribution', LifecyclePhase.Restored);
