/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode } from 'vs/base/common/keyCodes';
import { URI } from 'vs/base/common/uri';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/model';
import { LinkDetector } from 'vs/editor/contrib/links/browser/links';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TerminalSettingId } from 'vs/platform/terminal/common/terminal';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';
import { ITerminalFont } from 'vs/workbench/contrib/terminal/common/terminal';
import { IXtermTerminal } from 'vs/workbench/contrib/terminal/browser/terminal';
import type { Terminal } from 'xterm';
import { ILanguageFeaturesService } from 'vs/editor/common/services/languageFeatures';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DocumentSymbol } from 'vs/editor/common/languages';
import { CancellationTokenSource } from 'vs/editor/editor.api';
import { OutlineModel } from 'vs/editor/contrib/documentSymbols/browser/outlineModel';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { Dimension, IDomPosition } from 'vs/base/browser/dom';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IOutline, IOutlineCreator, IOutlineListConfig, IOutlineService, OutlineChangeEvent, OutlineTarget } from 'vs/workbench/services/outline/browser/outline';
import { OutlineEntry } from 'vs/workbench/contrib/notebook/browser/contrib/outline/notebookOutline';
import { IEditorPane } from 'vs/workbench/common/editor';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { Event } from 'vs/workbench/workbench.web.main';

const enum Constants {
	Scheme = 'terminal-accessible-buffer',
	Active = 'active',
	Hide = 'hide'
}

export class AccessibleBufferWidget extends EditorPane {
	public static ID: string = Constants.Scheme;
	private _accessibleBuffer: HTMLElement;
	private _bufferEditor: CodeEditorWidget;
	private _editorContainer: HTMLElement;
	private _font: ITerminalFont;
	private _xtermElement: HTMLElement;

	constructor(
		private readonly _instanceId: number,
		private readonly _xterm: IXtermTerminal & { raw: Terminal },
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IModelService private readonly _modelService: IModelService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService
	) {
		super('terminal-accessible-buffer', telemetryService, themeService, storageService);
		const codeEditorWidgetOptions: ICodeEditorWidgetOptions = {
			isSimpleWidget: true,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([LinkDetector.ID, SelectionClipboardContributionID])
		};
		this._font = _xterm.getFont();
		// this will be defined because we await the container opening
		this._xtermElement = _xterm.raw.element!;
		const editorOptions: IEditorConstructionOptions = {
			...getSimpleEditorOptions(),
			lineDecorationsWidth: 6,
			dragAndDrop: true,
			cursorWidth: 1,
			fontSize: this._font.fontSize,
			lineHeight: this._font.charHeight ? this._font.charHeight * this._font.lineHeight : 1,
			fontFamily: this._font.fontFamily,
			wrappingStrategy: 'advanced',
			wrappingIndent: 'none',
			padding: { top: 2, bottom: 2 },
			quickSuggestions: false,
			renderWhitespace: 'none',
			dropIntoEditor: { enabled: true },
			accessibilitySupport: this._configurationService.getValue<'auto' | 'off' | 'on'>('editor.accessibilitySupport'),
			cursorBlinking: this._configurationService.getValue('terminal.integrated.cursorBlinking'),
			readOnly: true
		};
		this._accessibleBuffer = document.createElement('div');
		this._accessibleBuffer.setAttribute('role', 'document');
		this._accessibleBuffer.ariaRoleDescription = localize('terminal.integrated.accessibleBuffer', 'Terminal buffer');
		this._accessibleBuffer.classList.add('accessible-buffer');
		this._editorContainer = document.createElement('div');
		this._bufferEditor = this._instantiationService.createInstance(CodeEditorWidget, this._editorContainer, editorOptions, codeEditorWidgetOptions);
		this._accessibleBuffer.replaceChildren(this._editorContainer);
		this._xtermElement.insertAdjacentElement('beforebegin', this._accessibleBuffer);
		this._bufferEditor.layout({ width: this._xtermElement.clientWidth, height: this._xtermElement.clientHeight });
		this._register(this._bufferEditor);
		this._bufferEditor.onKeyDown((e) => {
			// tab moves focus mode will prematurely move focus to the next element before
			// xterm can be focused
			if (e.keyCode === KeyCode.Escape || e.keyCode === KeyCode.Tab) {
				e.stopPropagation();
				e.preventDefault();
				this._hide();
			}
		});
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.has(TerminalSettingId.FontFamily)) {
				this._font = _xterm.getFont();
			}
		}));
		this._register(this._xterm.raw.onWriteParsed(async () => {
			if (this._accessibleBuffer.classList.contains(Constants.Active)) {
				await this._updateEditor(true);
			}
		}));
		this._register(this._bufferEditor.onDidFocusEditorText(() => this._accessibleBuffer.classList.add('active')));
		this._languageFeaturesService.documentSymbolProvider.register('terminal-accessible-buffer', {
			provideDocumentSymbols: (model: ITextModel, token: CancellationToken): Promise<DocumentSymbol[] | undefined> => {
				console.log(model);
				return Promise.resolve([{ name: 'test', detail: 'none', kind: 0, tags: [], range: { startLineNumber: 1, endLineNumber: 1, startColumn: 0, endColumn: 5 }, selectionRange: { startLineNumber: 1, endLineNumber: 1, startColumn: 0, endColumn: 5 } }]);
			}
		});
	}

	protected override createEditor(parent: HTMLElement): void {
		// parent.appendChild(this._bufferEditor.getDomNode()!);
		console.log(parent);
	}
	override layout(dimension: Dimension, position?: IDomPosition | undefined): void {
		this._bufferEditor.layout({ width: this._xtermElement.clientWidth, height: this._xtermElement.clientHeight });
	}

	private _hide(): void {
		this._accessibleBuffer.classList.remove(Constants.Active);
		this._xtermElement.classList.remove(Constants.Hide);
		this._xterm.raw.focus();
	}

	private async _updateModel(insertion?: boolean): Promise<void> {
		let model = this._bufferEditor.getModel();
		const lineCount = model?.getLineCount() ?? 0;
		const token = new CancellationTokenSource().token;
		const outlineModel = await OutlineModel.create(this._languageFeaturesService.documentSymbolProvider, model!, token);
		console.log(outlineModel.asListOfDocumentSymbols());
		if (insertion && model && lineCount > this._xterm.raw.rows) {
			const lineNumber = lineCount + 1;
			model.pushEditOperations(null, [{ range: { startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn: 1, endColumn: 1 }, text: await this._getContent(lineNumber - 1) }], () => []);
		} else {
			model = await this._getTextModel(URI.from({ scheme: `${Constants.Scheme}-${this._instanceId}`, fragment: await this._getContent() }));
		}
		if (!model) {
			throw new Error('Could not create accessible buffer editor model');
		}
		this._bufferEditor.setModel(model);
	}

	private async _updateEditor(insertion?: boolean): Promise<void> {
		await this._updateModel(insertion);
		const model = this._bufferEditor.getModel();
		if (!model) {
			return;
		}
		model.setLanguage('terminal-accessible-buffer');
		const lineNumber = model.getLineCount() - 1;
		const selection = this._bufferEditor.getSelection();
		// If the selection is at the top of the buffer, IE the default when not set, move it to the bottom
		if (selection?.startColumn === 1 && selection.endColumn === 1 && selection.startLineNumber === 1 && selection.endLineNumber === 1) {
			this._bufferEditor.setSelection({ startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: 1 });
		}
		this._bufferEditor.setScrollTop(this._bufferEditor.getScrollHeight());
		this._bufferEditor.focus();
	}

	async show(): Promise<void> {
		await this._updateEditor();
		this._accessibleBuffer.tabIndex = -1;
		this._bufferEditor.layout({ width: this._xtermElement.clientWidth, height: this._xtermElement.clientHeight });
		this._accessibleBuffer.classList.add(Constants.Active);
		this._xtermElement.classList.add(Constants.Hide);
	}

	private async _getTextModel(resource: URI): Promise<ITextModel | null> {
		const existing = this._modelService.getModel(resource);
		if (existing && !existing.isDisposed()) {
			return existing;
		}

		return this._modelService.createModel(resource.fragment, null, resource, false);
	}

	private _getContent(startLine?: number): string {
		const lines: string[] = [];
		let currentLine: string = '';
		const buffer = this._xterm?.raw.buffer.active;
		if (!buffer) {
			return '';
		}
		const end = buffer.length;
		for (let i = startLine ?? 0; i <= end; i++) {
			const line = buffer.getLine(i);
			if (!line) {
				continue;
			}
			const isWrapped = buffer.getLine(i + 1)?.isWrapped;
			currentLine += line.translateToString(!isWrapped);
			if (currentLine && !isWrapped || i === end - 1) {
				lines.push(currentLine.replace(new RegExp(' ', 'g'), '\xA0'));
				currentLine = '';
			}
		}
		return lines.join('\n');
	}
}

class TerminalOutlineCreator implements IOutlineCreator<AccessibleBufferWidget, OutlineEntry> {

	readonly dispose: () => void;

	constructor(
		@IOutlineService outlineService: IOutlineService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		const reg = outlineService.registerOutlineCreator(this);
		this.dispose = () => reg.dispose();
	}

	matches(candidate: IEditorPane): candidate is AccessibleBufferWidget {
		return candidate.getId() === AccessibleBufferWidget.ID;
	}

	async createOutline(editor: AccessibleBufferWidget, target: OutlineTarget): Promise<IOutline<OutlineEntry> | undefined> {
		return this._instantiationService.createInstance(AccessibleBufferOutline, editor, target);
	}
}

export class AccessibleBufferOutline implements IOutline<OutlineEntry> {
	uri: URI | undefined;
	config: IOutlineListConfig<OutlineEntry>;
	outlineKind: string;
	isEmpty: boolean;
	activeElement: OutlineEntry | undefined;
	onDidChange: Event<OutlineChangeEvent>;
	constructor(private readonly _editor: AccessibleBufferWidget,
		private readonly _target: OutlineTarget,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IEditorService private readonly _editorService: IEditorService,
		@IMarkerService private readonly _markerService: IMarkerService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		) {
			this.config = {
				breadcrumbsDataSource: {
					getBreadcrumbElements: () => {
						const result: OutlineEntry[] = [];
						let candidate = this._activeEntry;
						while (candidate) {
							result.unshift(candidate);
							candidate = candidate.parent;
						}
						return result;
					}
				},
				quickPickDataSource: instantiationService.createInstance(NotebookQuickPickProvider, () => this._entries),
				treeDataSource,
				delegate,
				renderers,
				comparator,
				options
			};
		}

	reveal(entry: OutlineEntry, options: IEditorOptions, sideBySide: boolean): void | Promise<void> {
		throw new Error('Method not implemented.');
	}
	preview(entry: OutlineEntry): IDisposable {
		throw new Error('Method not implemented.');
	}
	captureViewState(): IDisposable {
		throw new Error('Method not implemented.');
	}
	dispose(): void {
		throw new Error('Method not implemented.');
	}

}

