import {
    App,
    ButtonComponent,
    TextComponent,
    DropdownComponent,
    ToggleComponent,
} from 'obsidian';

import { PluginSettings, MapLightDark } from 'src/settings';

import { MapState, areStatesEqual, mergeStates } from 'src/mapState';
import { MapView } from 'src/mapView';
import { NewPresetDialog } from 'src/newPresetDialog';
import MapViewPlugin from 'src/main';
import { QuerySuggest } from 'src/query';
import { LocationSearchDialog, SuggestInfo } from 'src/locationSearchDialog';
import { MarkersMap } from 'src/markers';

import * as leaflet from 'leaflet';

export class ViewControls {
    private parentElement: HTMLElement;
    private settings: PluginSettings;
    private app: App;
    private view: MapView;
    private plugin: MapViewPlugin;

    public controlsDiv: HTMLDivElement;
    private queryBox: TextComponent;
    private mapSourceBox: DropdownComponent;
    private sourceMode: DropdownComponent;
    private followActiveNoteToggle: ToggleComponent;

    private presetsDiv: HTMLDivElement;
    private presetsDivContent: HTMLDivElement = null;
    private presetsBox: DropdownComponent;
    private lastSelectedPresetIndex: number = null;
    private lastSelectedPreset: MapState = null;
    private queryDelayMs = 250;
    private lastQueryTime: number;
	private updateOngoing = false;

    constructor(
        parentElement: HTMLElement,
        settings: PluginSettings,
        app: App,
        view: MapView,
        plugin: MapViewPlugin
    ) {
        this.parentElement = parentElement;
        this.settings = settings;
        this.app = app;
        this.view = view;
        this.plugin = plugin;
    }

    getCurrentState(): MapState {
        return this.view.getState() as MapState;
    }

    async setNewState(newState: MapState, considerAutoFit: boolean) {
		if (!this.updateOngoing)
			await this.view.setViewState(newState, false, considerAutoFit);
    }

    async setStateByNewMapSource(newSource: number) {
        // Update the state assuming the controls are updated
        const state = this.getCurrentState();
        await this.setNewState({ ...state, chosenMapSource: newSource }, false);
    }

    async setStateByFollowActiveNote(follow: boolean) {
        const state = this.getCurrentState();
        await this.setNewState({ ...state, followActiveNote: follow }, false);
    }

    public tryToGuessPreset() {
        // Try to guess the preset based on the current state, and choose it in the dropdown
        // (e.g. for when the plugin loads with a state)
        const currentState = this.getCurrentState();
        const states = [
            this.settings.defaultState,
            ...(this.settings.savedStates || []),
        ];
        for (const [index, state] of states.entries())
            if (areStatesEqual(state, currentState)) {
                this.presetsBox.setValue(index.toString());
                this.lastSelectedPresetIndex = index;
                this.lastSelectedPreset = currentState;
                break;
            }
    }

    public updateControlsToState() {
		// This updates the controls according to the given state, and prevents a feedback loop by
		// raising the updateOngoing flag
		this.updateOngoing = true;
        this.setMapSourceBoxByState();
        this.setQueryBoxByState();
        this.followActiveNoteToggle.setValue(
            this.getCurrentState().followActiveNote == true
        );
		this.updateOngoing = false;
    }

    private setMapSourceBoxByState() {
        this.mapSourceBox.setValue(
            this.getCurrentState().chosenMapSource.toString()
        );
    }

    async setStateByQueryString(newQuery: string) {
        // Start a timer and update the actual query only if no newer query came in
        const timestamp = Date.now();
        this.lastQueryTime = timestamp;
        const Sleep = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
        await Sleep(this.queryDelayMs);
        if (this.lastQueryTime != timestamp) {
            // Query is canceled by a newer query
            return;
        }
        // Update the state assuming the UI is updated
        const state = this.getCurrentState();
        this.invalidateActivePreset();
        await this.setNewState(
            { ...state, query: newQuery },
            newQuery.length > 0
        );
    }

    private setQueryBoxByState() {
        // Update the UI based on the state
        const state = this.getCurrentState();
        this.queryBox.setValue(state.query);
        this.setQueryBoxErrorByState();
    }

    setQueryBoxErrorByState() {
        const state = this.getCurrentState();
        if (state.queryError)
            this.queryBox.inputEl.addClass('graph-control-error');
        else this.queryBox.inputEl.removeClass('graph-control-error');
    }

    public reload() {
        if (this.controlsDiv) this.controlsDiv.remove();
        this.createControls();
    }

    createControls() {
        this.controlsDiv = createDiv({
            cls: 'graph-controls',
        });
        let filtersDiv = this.controlsDiv.createDiv({
            cls: 'graph-control-div',
        });
        filtersDiv.innerHTML = `
			<input id="filtersCollapsible" class="controls-toggle" type="checkbox">
			<label for="filtersCollapsible" class="lbl-triangle">▸</label>
			<label for="filtersCollapsible" class="lbl-toggle">Filters</label>
			`;
        const filtersButton = filtersDiv.getElementsByClassName(
            'controls-toggle'
        )[0] as HTMLInputElement;
        filtersButton.checked = this.settings.mapControls.filtersDisplayed;
        filtersButton.onclick = async () => {
            this.settings.mapControls.filtersDisplayed = filtersButton.checked;
            this.plugin.saveSettings();
        };
        let filtersContent = filtersDiv.createDiv({
            cls: 'graph-control-content',
        });
        // Wrapping the query box in a div so we can place a button in the right-middle of it
        const queryDiv = filtersContent.createDiv('search-input-container');
        queryDiv.style.margin = '0';
        this.queryBox = new TextComponent(queryDiv);
        this.queryBox.setPlaceholder('Query');
        this.queryBox.onChange((query: string) => {
            this.setStateByQueryString(query);
        });
        let suggestor: QuerySuggest = null;
        this.queryBox.inputEl.addEventListener('focus', (ev: FocusEvent) => {
            if (!suggestor) {
                suggestor = new QuerySuggest(this.app, this.queryBox);
                suggestor.open();
            }
        });
        this.queryBox.inputEl.addEventListener('focusout', (ev: FocusEvent) => {
            if (suggestor) {
                suggestor.close();
                suggestor = null;
            }
        });
        let clearButton = queryDiv.createDiv('search-input-clear-button');
        clearButton.onClickEvent((ev) => {
            this.queryBox.setValue('');
            this.setStateByQueryString('');
        });

        let viewDiv = this.controlsDiv.createDiv({ cls: 'graph-control-div' });
        viewDiv.innerHTML = `
			<input id="viewCollapsible" class="controls-toggle" type="checkbox">
			<label for="viewCollapsible" class="lbl-triangle">▸</label>
			<label for="viewCollapsible" class="lbl-toggle">View</label>
			`;
        const viewButton = viewDiv.getElementsByClassName(
            'controls-toggle'
        )[0] as HTMLInputElement;
        viewButton.checked = this.settings.mapControls.viewDisplayed;
        viewButton.onclick = async () => {
            this.settings.mapControls.viewDisplayed = viewButton.checked;
            this.plugin.saveSettings();
        };
        let viewDivContent = viewDiv.createDiv({
            cls: 'graph-control-content',
        });
        this.mapSourceBox = new DropdownComponent(viewDivContent);
        for (const [index, source] of this.settings.mapSources.entries()) {
            this.mapSourceBox.addOption(index.toString(), source.name);
        }
        this.mapSourceBox.onChange(async (value: string) => {
            this.setStateByNewMapSource(parseInt(value));
        });
        this.setMapSourceBoxByState();
        this.sourceMode = new DropdownComponent(viewDivContent);
        this.sourceMode
            .addOptions({ auto: 'Auto', light: 'Light', dark: 'Dark' })
            .setValue(this.settings.chosenMapMode ?? 'auto')
            .onChange(async (value) => {
                this.settings.chosenMapMode = value as MapLightDark;
                await this.plugin.saveSettings();
                this.view.refreshMap();
            });
        let goDefault = new ButtonComponent(viewDivContent);
        goDefault
            .setButtonText('Reset')
            .setTooltip('Reset the view to the defined default.')
            .onClick(async () => {
                this.presetsBox.setValue('0');
                await this.choosePresetAndUpdateState(0);
                this.updateControlsToState();
            });
        let fitButton = new ButtonComponent(viewDivContent);
        fitButton
            .setButtonText('Fit')
            .setTooltip(
                'Set the map view to fit all currently-displayed markers.'
            )
            .onClick(() => this.view.autoFitMapToMarkers());
        const followDiv = viewDivContent.createDiv({
            cls: 'graph-control-follow-div',
        });
        this.followActiveNoteToggle = new ToggleComponent(followDiv);
        const followLabel = followDiv.createEl('label');
        followLabel.className = 'graph-control-follow-label';
        followLabel.addEventListener('click', () =>
            this.followActiveNoteToggle.onClick()
        );
        followLabel.innerHTML = 'Follow active note';
        this.followActiveNoteToggle.onChange((value) => {
            this.setStateByFollowActiveNote(value);
        });

        this.presetsDiv = this.controlsDiv.createDiv({
            cls: 'graph-control-div',
        });
        this.presetsDiv.innerHTML = `
			<input id="presetsCollapsible" class="controls-toggle" type="checkbox">
			<label for="presetsCollapsible" class="lbl-triangle">▸</label>
			<label for="presetsCollapsible" class="lbl-toggle">Presets</label>
			`;
        const presetsButton = this.presetsDiv.getElementsByClassName(
            'controls-toggle'
        )[0] as HTMLInputElement;
        presetsButton.checked = this.settings.mapControls.presetsDisplayed;
        presetsButton.onclick = async () => {
            this.settings.mapControls.presetsDisplayed = presetsButton.checked;
            this.plugin.saveSettings();
        };
        this.refreshPresets();

        this.parentElement.append(this.controlsDiv);
    }

    async choosePresetAndUpdateState(chosenPresetNumber: number) {
        // Hacky code, not very happy with it... Entry 0 is the default, then 1 is assumed to be the first saved state
        const chosenPreset =
            chosenPresetNumber == 0
                ? this.settings.defaultState
                : this.settings.savedStates[chosenPresetNumber - 1];
        this.lastSelectedPresetIndex = chosenPresetNumber;
        this.lastSelectedPreset = mergeStates(
            this.getCurrentState(),
            chosenPreset
        );
        await this.setNewState({ ...chosenPreset }, false);
        this.updateControlsToState();
    }

    refreshPresets() {
        if (this.presetsDivContent) this.presetsDivContent.remove();
        this.presetsDivContent = this.presetsDiv.createDiv({
            cls: 'graph-control-content',
        });
        this.presetsBox = new DropdownComponent(this.presetsDivContent);
        const states = [
            this.settings.defaultState,
            ...(this.settings.savedStates || []),
        ];
        this.presetsBox.addOption('-1', '');
        for (const [index, preset] of states.entries()) {
            this.presetsBox.addOption(index.toString(), preset.name);
        }
        if (
            this.lastSelectedPresetIndex &&
            this.lastSelectedPresetIndex < states.length &&
            areStatesEqual(this.getCurrentState(), this.lastSelectedPreset)
        )
            this.presetsBox.setValue(this.lastSelectedPreset.toString());
        this.presetsBox.onChange(async (value: string) => {
            const chosenPresetNumber = parseInt(value);
            if (chosenPresetNumber == -1) return;
            await this.choosePresetAndUpdateState(chosenPresetNumber);
        });
        let savePreset = new ButtonComponent(this.presetsDivContent);
        savePreset
            .setButtonText('Save as...')
            .setTooltip('Save the current view as a preset.')
            .onClick(() => {
                const dialog = new NewPresetDialog(
                    this.app,
                    this.getCurrentState(),
                    this.plugin,
                    this.settings,
                    (index: string) => {
                        // If a new preset was added, this small function makes sure it's selected afterwards
                        this.refreshPresets();
                        if (index) this.presetsBox.setValue(index);
                    }
                );
                dialog.open();
            });
        let deletePreset = new ButtonComponent(this.presetsDivContent);
        deletePreset
            .setButtonText('Delete')
            .setTooltip('Delete the currently-selected preset.')
            .onClick(async () => {
                const selectionIndex = parseInt(this.presetsBox.getValue());
                if (selectionIndex > 0) {
                    this.settings.savedStates.splice(selectionIndex - 1, 1);
                    await this.plugin.saveSettings();
                    this.refreshPresets();
                }
            });
        let saveAsDefault = new ButtonComponent(this.presetsDivContent);
        saveAsDefault
            .setButtonText('Save as Default')
            .setTooltip('Save the current view as the default one.')
            .onClick(async () => {
                this.settings.defaultState = {
                    ...this.getCurrentState(),
                    name: 'Default',
                };
                await this.plugin.saveSettings();
                this.presetsBox.setValue('0');
            });
        new ButtonComponent(this.presetsDivContent)
            .setButtonText('Copy URL')
            .setTooltip('Copy the current view as a URL.')
            .onClick(async () => {
                this.view.copyStateUrl();
            });
    }

    invalidateActivePreset() {
        if (!areStatesEqual(this.getCurrentState(), this.lastSelectedPreset)) {
            this.presetsBox.setValue('-1');
        }
    }
}

export class SearchControl extends leaflet.Control {
    view: MapView;
    app: App;
    settings: PluginSettings;
    searchButton: HTMLAnchorElement;
    clearButton: HTMLAnchorElement;

    constructor(
        options: any,
        view: MapView,
        app: App,
        settings: PluginSettings
    ) {
        super(options);
        this.view = view;
        this.app = app;
        this.settings = settings;
    }

    onAdd(map: leaflet.Map) {
        const div = leaflet.DomUtil.create(
            'div',
            'leaflet-bar leaflet-control'
        );
        this.searchButton = div.createEl('a');
        this.searchButton.innerHTML = '🔍';
        this.searchButton.onClickEvent((ev: MouseEvent) => {
            this.openSearch(this.view.getMarkers());
        });
        this.clearButton = div.createEl('a');
        this.clearButton.innerHTML = 'X';
        this.clearButton.style.display = 'none';
        this.clearButton.onClickEvent((ev: MouseEvent) => {
            this.view.removeSearchResultMarker();
            this.clearButton.style.display = 'none';
        });

        return div;
    }

    openSearch(existingMarkers: MarkersMap) {
        let markerSearchResults: SuggestInfo[] = [];
        for (const fileMarker of existingMarkers.values()) {
            markerSearchResults.push({
                name: fileMarker.extraName
                    ? `${fileMarker.extraName} (${fileMarker.file.basename})`
                    : fileMarker.file.basename,
                location: fileMarker.location,
                resultType: 'existingMarker',
                icon: fileMarker.icon.options,
            });
        }
        const searchDialog = new LocationSearchDialog(
            this.app,
            this.settings,
            'custom',
            'Find in map',
            null,
            markerSearchResults,
            true
        );
        searchDialog.customOnSelect = (selection: SuggestInfo) => {
            this.view.removeSearchResultMarker();
            if (selection && selection.resultType == 'existingMarker') {
                this.view.zoomToSearchResult(selection.location);
            } else if (selection && selection.location) {
                this.view.addSearchResultMarker(selection);
                this.clearButton.style.display = 'block';
            }
        };
        searchDialog.open();
    }
}
