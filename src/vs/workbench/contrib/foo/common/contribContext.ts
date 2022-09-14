/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Emitter } from 'vs/base/common/event';
import type { DisposableStore } from 'vs/base/common/lifecycle';

export interface IAsyncContribContext {
	event: {
		Emitter: typeof Emitter;
	};
	lifecycle: {
		DisposableStore: typeof DisposableStore;
	};
}
