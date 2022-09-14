/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export class FooContribution {
	constructor(
		outsideDependencies: { EmitterCtor: typeof Emitter },
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		console.log('foo contribution init', instantiationService);

		// Example inlined object - this imports the entire file into the bundled file
		const inlinedObject = new DisposableStore();

		// Example of injected object - this injects the object, note the `import type` at the top
		const injectedObject = new outsideDependencies.EmitterCtor();
		// TODO: This is not particularly ergonomic, is there a nicer way to get this to work?
		//       Could pass a common context object around?

		console.log({ inlinedObject, injectedObject });
	}
}
