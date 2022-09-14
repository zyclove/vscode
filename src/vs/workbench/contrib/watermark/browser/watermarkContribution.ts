/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Imports
import { Disposable } from 'vs/base/common/lifecycle';
import 'vs/css!./media/watermark';
import * as nls from 'vs/nls';

// Types only
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpression, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { TerminalContextKeys } from 'vs/workbench/contrib/terminal/common/terminalContextKey';
import { IContribContext } from 'vs/workbench/contrib/watermark/browser/contribContextInterface';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import type * as dom from 'vs/base/browser/dom';

interface WatermarkEntry {
	text: string;
	id: string;
	mac?: boolean;
	when?: ContextKeyExpression;
}

// TODO: Use const enums for all ids, this section imports a lot of code
//       Should we use <component>.internal.d.ts for internal API and only allow importing service interfaces/decorators from <component>.ts?
//       Alternatively have .internal.d.ts and .service.ts?
const showCommands: WatermarkEntry = { text: nls.localize('watermark.showCommands', "Show All Commands"), id: 'workbench.action.showCommands' };
const quickAccess: WatermarkEntry = { text: nls.localize('watermark.quickAccess', "Go to File"), id: 'workbench.action.quickOpen' };
const openFileNonMacOnly: WatermarkEntry = { text: nls.localize('watermark.openFile', "Open File"), id: 'workbench.action.files.openFile', mac: false };
const openFolderNonMacOnly: WatermarkEntry = { text: nls.localize('watermark.openFolder', "Open Folder"), id: 'workbench.action.files.openFolder', mac: false };
const openFileOrFolderMacOnly: WatermarkEntry = { text: nls.localize('watermark.openFileFolder', "Open File or Folder"), id: 'workbench.action.files.openFileFolder', mac: true };
const openRecent: WatermarkEntry = { text: nls.localize('watermark.openRecent', "Open Recent"), id: 'workbench.action.openRecent' };
const newUntitledFile: WatermarkEntry = { text: nls.localize('watermark.newUntitledFile', "New Untitled File"), id: 'workbench.action.files.newUntitledFile' };
const newUntitledFileMacOnly: WatermarkEntry = Object.assign({ mac: true }, newUntitledFile);
const findInFiles: WatermarkEntry = { text: nls.localize('watermark.findInFiles', "Find in Files"), id: 'workbench.action.findInFiles' };
const toggleTerminal: WatermarkEntry = { text: nls.localize({ key: 'watermark.toggleTerminal', comment: ['toggle is a verb here'] }, "Toggle Terminal"), id: 'workbench.action.terminal.toggleTerminal', when: TerminalContextKeys.processSupported };
const startDebugging: WatermarkEntry = { text: nls.localize('watermark.startDebugging', "Start Debugging"), id: 'workbench.action.debug.start', when: TerminalContextKeys.processSupported };
const toggleFullscreen: WatermarkEntry = { text: nls.localize({ key: 'watermark.toggleFullscreen', comment: ['toggle is a verb here'] }, "Toggle Full Screen"), id: 'workbench.action.toggleFullScreen', when: TerminalContextKeys.processSupported.toNegated() };
const showSettings: WatermarkEntry = { text: nls.localize('watermark.showSettings', "Show Settings"), id: 'workbench.action.openSettings', when: TerminalContextKeys.processSupported.toNegated() };

const noFolderEntries = [
	showCommands,
	openFileNonMacOnly,
	openFolderNonMacOnly,
	openFileOrFolderMacOnly,
	openRecent,
	newUntitledFileMacOnly
];

const folderEntries = [
	showCommands,
	quickAccess,
	findInFiles,
	startDebugging,
	toggleTerminal,
	toggleFullscreen,
	showSettings
];

const WORKBENCH_TIPS_ENABLED_KEY = 'workbench.tips.enabled';

// TODO: Can't use context for Disposable
export class WatermarkContribution extends Disposable implements IWorkbenchContribution {
	private watermark: HTMLElement | undefined;
	private watermarkDisposable = this._register(new this._ctx.base.lifecycle.DisposableStore());
	private enabled: boolean;
	private workbenchState: WorkbenchState;

	private readonly _dom: typeof dom;
	private readonly _$: typeof dom.$;

	constructor(
		private readonly _ctx: IContribContext,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IThemeService private readonly themeService: IThemeService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super();

		this._dom = _ctx.base.dom;
		this._$ = _ctx.base.dom.$;

		this.workbenchState = contextService.getWorkbenchState();
		this.enabled = this.configurationService.getValue<boolean>(WORKBENCH_TIPS_ENABLED_KEY);

		this.registerListeners();

		if (this.enabled) {
			this.create();
		}
	}

	private registerListeners(): void {
		this.lifecycleService.onDidShutdown(() => this.dispose());

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(WORKBENCH_TIPS_ENABLED_KEY)) {
				const enabled = this.configurationService.getValue<boolean>(WORKBENCH_TIPS_ENABLED_KEY);
				if (enabled !== this.enabled) {
					this.enabled = enabled;
					if (this.enabled) {
						this.create();
					} else {
						this.destroy();
					}
				}
			}
		}));

		this._register(this.contextService.onDidChangeWorkbenchState(e => {
			const previousWorkbenchState = this.workbenchState;
			this.workbenchState = this.contextService.getWorkbenchState();

			if (this.enabled && this.workbenchState !== previousWorkbenchState) {
				this.recreate();
			}
		}));

		const allEntriesWhenClauses = [...noFolderEntries, ...folderEntries].filter(entry => entry.when !== undefined).map(entry => entry.when!);
		const allKeys = new Set<string>();
		allEntriesWhenClauses.forEach(when => when.keys().forEach(key => allKeys.add(key)));
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(allKeys)) {
				this.recreate();
			}
		}));
	}

	private create(): void {
		const container = this._ctx.base.types.assertIsDefined(this.layoutService.getContainer(Parts.EDITOR_PART));
		container.classList.add('has-watermark');

		this.watermark = this._$('.watermark');
		const box = this._dom.append(this.watermark, this._$('.watermark-box'));
		const folder = this.workbenchState !== WorkbenchState.EMPTY;
		const selected = (folder ? folderEntries : noFolderEntries)
			.filter(entry => !('when' in entry) || this.contextKeyService.contextMatchesRules(entry.when))
			.filter(entry => !('mac' in entry) || entry.mac === (this._ctx.base.platform.isMacintosh && !this._ctx.base.platform.isWeb))
			.filter(entry => !!this._ctx.base.platform.commands.CommandsRegistry.getCommand(entry.id));

		const keybindingLabelStylers = this.watermarkDisposable.add(new this._ctx.base.lifecycle.DisposableStore());

		const update = () => {
			this._dom.clearNode(box);
			keybindingLabelStylers.clear();
			selected.map(entry => {
				const dl = this._dom.append(box, this._$('dl'));
				const dt = this._dom.append(dl, this._$('dt'));
				dt.textContent = entry.text;
				const dd = this._dom.append(dl, this._$('dd'));
				const keybinding = new this._ctx.base.ui.keybindingLabel.KeybindingLabel(dd, this._ctx.base.platform.OS, { renderUnboundKeybindings: true });
				keybindingLabelStylers.add(this._ctx.base.platform.theme.styler.attachKeybindingLabelStyler(keybinding, this.themeService));
				keybinding.set(this.keybindingService.lookupKeybinding(entry.id));
			});
		};

		update();

		this._dom.prepend(container.firstElementChild as HTMLElement, this.watermark);

		this.watermarkDisposable.add(this.keybindingService.onDidUpdateKeybindings(update));
		this.watermarkDisposable.add(this.editorGroupsService.onDidLayout(dimension => this.handleEditorPartSize(container, dimension)));

		this.handleEditorPartSize(container, this.editorGroupsService.contentDimension);

		/* __GDPR__
		"watermark:open" : {
			"owner": "digitarald"
		}
		*/
		this.telemetryService.publicLog('watermark:open');
	}

	private handleEditorPartSize(container: HTMLElement, dimension: dom.IDimension): void {
		container.classList.toggle('max-height-478px', dimension.height <= 478);
	}

	private destroy(): void {
		if (this.watermark) {
			this.watermark.remove();

			const container = this.layoutService.getContainer(Parts.EDITOR_PART);
			container?.classList.remove('has-watermark');

			this.watermarkDisposable.clear();
		}
	}

	private recreate(): void {
		this.destroy();
		this.create();
	}
}
