/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export class TabFocusImpl {
	private _tabFocus: boolean;

	private readonly _onDidChangeTabFocus = new Emitter<boolean>();
	public readonly onDidChangeTabFocus: Event<boolean> = this._onDidChangeTabFocus.event;

	constructor(settingId: string, @IConfigurationService configurationService: IConfigurationService) {
		this._tabFocus = configurationService.getValue(settingId);
		configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(settingId)) {
				this.setTabFocusMode(configurationService.getValue(settingId));
			}
		});
		this._onDidChangeTabFocus.fire(this.getTabFocusMode());
	}

	public getTabFocusMode(): boolean {
		return this._tabFocus;
	}

	public setTabFocusMode(tabFocusMode: boolean): void {
		if (this._tabFocus === tabFocusMode) {
			return;
		}

		this._tabFocus = tabFocusMode;
		this._onDidChangeTabFocus.fire(this._tabFocus);
	}
}
