/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export interface IServiceFetcher<T> {
	_serviceBrand: undefined;
	service: Promise<T>;
}

export abstract class BaseServiceFetcher<T> implements IServiceFetcher<T> {
	_serviceBrand: undefined;

	private _service?: Promise<T>;
	get service(): Promise<T> {
		if (!this._service) {
			this._service = this._loadAndCreateService(this._instantiationService);
		}
		return this._service;
	}

	constructor(@IInstantiationService private readonly _instantiationService: IInstantiationService) { }

	protected abstract _loadAndCreateService(instantiationService: IInstantiationService): Promise<T>;
}
