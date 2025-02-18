import { Editor, App, SuggestModal, TFile } from 'obsidian';
import * as leaflet from 'leaflet';

import { PluginSettings } from 'src/settings';
import { GeoSearcher, GeoSearchResult } from 'src/geosearch';
import { getIconFromOptions } from 'src/markers';
import * as utils from 'src/utils';
import * as consts from 'src/consts';

export class SuggestInfo extends GeoSearchResult {
    icon?: leaflet.ExtraMarkers.IconOptions;
}

type DialogAction = 'newNote' | 'addToNote' | 'custom';

export class LocationSearchDialog extends SuggestModal<SuggestInfo> {
    private settings: PluginSettings;
    private searcher: GeoSearcher;
    private lastSearchTime = 0;
    private delayInMs = 250;
    private lastSearch = '';
    private lastSearchResults: SuggestInfo[] = [];
    private includeResults: SuggestInfo[] = [];
    private hasIcons: boolean = false;

    private dialogAction: DialogAction;
    private editor: Editor = null;

    // If dialogAction is 'custom', this will launch upon selection
    public customOnSelect: (selection: SuggestInfo) => void;

    constructor(
        app: App,
        settings: PluginSettings,
        dialogAction: DialogAction,
        title: string,
        editor: Editor = null,
        includeResults: SuggestInfo[] = null,
        hasIcons: boolean = false
    ) {
        super(app);
        this.settings = settings;
        this.searcher = new GeoSearcher(app, settings);
        this.dialogAction = dialogAction;
        this.editor = editor;
        this.includeResults = includeResults;
        this.hasIcons = hasIcons;

        this.setPlaceholder(
            title + ': type a place name or paste a string to parse'
        );
        this.setInstructions([{ command: 'enter', purpose: 'to use' }]);
    }

    getSuggestions(query: string) {
        let result: SuggestInfo[] = [];
        // Get results from the "to include" list, e.g. existing markers
        let resultsToInclude: SuggestInfo[] = [];
        if (this.includeResults)
            for (const toInclude of this.includeResults) {
                if (
                    query.length == 0 ||
                    toInclude.name.toLowerCase().includes(query.toLowerCase())
                )
                    resultsToInclude.push(toInclude);
                if (resultsToInclude.length >= consts.MAX_MARKER_SUGGESTIONS)
                    break;
            }
        result = result.concat(resultsToInclude);

        // From this point onward, results are added asynchronously.
        // We make sure to add them *after* the synchronuous results, otherwise
        // it will be very annoying for a user who may have already selected something.
        if (query == this.lastSearch) {
            result = result.concat(this.lastSearchResults);
        }
        this.getSearchResultsWithDelay(query);
        return result;
    }

    renderSuggestion(value: SuggestInfo, el: HTMLElement) {
        el.addClass('map-search-suggestion');
        if (this.hasIcons) {
            let iconDiv = el.createDiv('search-icon-div');
            const compiledIcon = getIconFromOptions(
                value.icon ?? consts.SEARCH_RESULT_MARKER
            );
            let iconElement: HTMLElement = compiledIcon.createIcon();
            let style = iconElement.style;
            style.marginLeft = style.marginTop = '0';
            style.position = 'relative';
            iconDiv.append(iconElement);
            let textDiv = el.createDiv('search-text-div');
            textDiv.appendText(value.name);
        } else el.appendText(value.name);
    }

    onChooseSuggestion(value: SuggestInfo, evt: MouseEvent | KeyboardEvent) {
        if (this.dialogAction == 'newNote')
            this.newNote(value.location, evt, value.name);
        else if (this.dialogAction == 'addToNote')
            this.addToNote(value.location, evt, value.name);
        else if (this.dialogAction == 'custom' && this.customOnSelect != null)
            this.customOnSelect(value);
    }

    async newNote(
        location: leaflet.LatLng,
        ev: MouseEvent | KeyboardEvent,
        query: string
    ) {
        const locationString = `${location.lat},${location.lng}`;
        const newFileName = utils.formatWithTemplates(
            this.settings.newNoteNameFormat,
            query
        );
        const file: TFile = await utils.newNote(
            this.app,
            'singleLocation',
            this.settings.newNotePath,
            newFileName,
            locationString,
            this.settings.newNoteTemplate
        );
        // If there is an open map view, use it to decide how and where to open the file.
        // Otherwise, open the file from the active leaf
        const mapView = utils.findOpenMapView(this.app);
        if (mapView) {
            mapView.goToFile(file, ev.ctrlKey, utils.handleNewNoteCursorMarker);
        } else {
            const leaf = this.app.workspace.activeLeaf;
            await leaf.openFile(file);
            const editor = await utils.getEditor(this.app);
            if (editor) await utils.handleNewNoteCursorMarker(editor);
        }
    }

    async addToNote(
        location: leaflet.LatLng,
        ev: MouseEvent | KeyboardEvent,
        query: string
    ) {
        const locationString = `[${location.lat},${location.lng}]`;
        utils.verifyOrAddFrontMatter(this.editor, 'location', locationString);
    }

    async getSearchResultsWithDelay(query: string) {
        if (query === this.lastSearch || query.length < 3) return;
        const timestamp = Date.now();
        this.lastSearchTime = timestamp;
        const Sleep = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
        await Sleep(this.delayInMs);
        if (this.lastSearchTime != timestamp) {
            // Search is canceled by a newer search
            return;
        }
        // After the sleep our search is still the last -- so the user stopped and we can go on
        this.lastSearch = query;
        this.lastSearchResults = await this.searcher.search(query);
        (this as any).updateSuggestions();
    }
}
