import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {CUSTOM_COLOR_KEYS, isCustomColor, THEME_IDS} from './themes.js';

function normalizeFontSearch(text) {
    return text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function matchesFontSearch(name, query) {
    let offset = 0;
    for (const character of query) {
        const index = name.indexOf(character, offset);
        if (index < 0)
            return false;
        offset = index + character.length;
    }
    return true;
}

class KimpanelPrefsWidget extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super();
        this._settings = settings;
        this._settingsSignalIds = [];

        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
        });
        this.add(appearanceGroup);

        let row = new Adw.ComboRow({title: _('Theme')});
        let model = new Gtk.StringList();
        const themeLabels = {
            default: _('Default (follow system style)'),
            pink: _('Pink'),
            blue: _('Blue'),
        };
        for (const id of THEME_IDS)
            model.append(themeLabels[id]);
        row.set_model(model);
        const themeRow = row;
        this._selectTheme(themeRow);
        row.connect('notify::selected', (comboRow) => {
            const id = THEME_IDS[comboRow.selected];
            if (id && this._settings.get_string('theme') !== id)
                this._settings.set_string('theme', id);
        });
        this._settingsSignalIds.push(this._settings.connect(
            'changed::theme',
            () => this._selectTheme(themeRow)));
        appearanceGroup.add(row);

        let button = new Gtk.Button({valign: Gtk.Align.CENTER});
        row = new Adw.ActionRow({
            title: _('Font'),
            activatable_widget: button,
        });
        this._settings.bind('font', button, 'label', Gio.SettingsBindFlags.GET);
        button.connect('clicked', () => this._chooseFont());
        row.add_suffix(button);
        appearanceGroup.add(row);

        const candidateGroup = new Adw.PreferencesGroup({
            title: _('Candidate List'),
        });
        this.add(candidateGroup);

        let toggle = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });
        row = new Adw.ActionRow({
            title: _('Vertical List'),
            activatable_widget: toggle,
        });
        this._settings.bind('vertical', toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(toggle);
        candidateGroup.add(row);

        const stylesGroup = new Adw.PreferencesGroup({
            title: _('Custom Style'),
        });
        this.add(stylesGroup);

        const colorLabels = {
            'panel-background': _('Panel Background'),
            'panel-text': _('Text Color'),
            'highlight-background': _('Highlight Background'),
            'highlight-text': _('Highlight Text'),
        };
        for (const key of CUSTOM_COLOR_KEYS)
            stylesGroup.add(this._createColorRow(key, colorLabels[key]));
    }

    _createColorRow(key, title) {
        const dialog = new Gtk.ColorDialog({title, with_alpha: false});
        const picker = new Gtk.Button({
            valign: Gtk.Align.CENTER,
        });
        const preview = new Gtk.DrawingArea({
            content_width: 16,
            content_height: 16,
            valign: Gtk.Align.CENTER,
        });
        const valueLabel = new Gtk.Label({xalign: 0});
        const pickerContent = new Gtk.Box({spacing: 8, halign: Gtk.Align.CENTER});
        pickerContent.append(preview);
        pickerContent.append(valueLabel);
        picker.set_child(pickerContent);
        let previewColor = null;
        preview.set_draw_func((_area, cr, width, height) => {
            if (!previewColor)
                return;
            const {red, green, blue} = previewColor;
            cr.setSourceRGB(red, green, blue);
            cr.rectangle(1, 1, width - 2, height - 2);
            cr.fillPreserve();
            cr.setSourceRGBA(0.5, 0.5, 0.5, 0.65);
            cr.setLineWidth(1);
            cr.stroke();
        });
        const reset = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: _('Restore Default'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const row = new Adw.ActionRow({title});
        row.add_suffix(picker);
        row.add_suffix(reset);

        const sync = () => {
            const color = this._settings.get_string(key);
            const customized = isCustomColor(color);
            previewColor = customized ? new Gdk.RGBA() : null;
            if (previewColor)
                previewColor.parse(color);
            preview.visible = customized;
            preview.queue_draw();
            valueLabel.label = customized ? color.toUpperCase() : _('Choose Color…');
            row.subtitle = customized ? '' : _('Use Theme Color');
            reset.sensitive = color !== '';
        };
        this._settingsSignalIds.push(this._settings.connect(`changed::${key}`, sync));
        sync();

        picker.connect('clicked', () => {
            dialog.choose_rgba(this.get_root(), previewColor, null, (source, result) => {
                let rgba;
                try {
                    rgba = source.choose_rgba_finish(result);
                } catch (error) {
                    if (!error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED) &&
                        !error.matches(Gtk.DialogError, Gtk.DialogError.CANCELLED))
                        logError(error);
                    return;
                }
                const hex = [rgba.red, rgba.green, rgba.blue].map(channel =>
                    Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
                this._settings?.set_string(key, `#${hex}`);
            });
        });
        reset.connect('clicked', () => this._settings.reset(key));
        return row;
    }

    _selectTheme(comboRow) {
        const themeId = this._settings.get_string('theme');
        comboRow.selected = THEME_IDS.indexOf(themeId);
    }

    _chooseFont() {
        const dialog = new Gtk.Dialog({
            title: _('Font'),
            transient_for: this.get_root(),
            modal: true,
            use_header_bar: true,
            default_width: 520,
            default_height: 460,
        });
        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Apply'), Gtk.ResponseType.APPLY);

        const current = Pango.FontDescription.from_string(
            this._settings.get_string('font') || 'Sans 11');
        const size = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 1000,
                step_increment: 1,
                value: current.get_size() / Pango.SCALE || 11,
            }),
            digits: 2,
            numeric: true,
        });
        current.unset_fields(Pango.FontMask.SIZE);
        const currentFace = current.to_string();
        const names = new Set();
        for (const family of this.get_pango_context().list_families()) {
            for (const face of family.list_faces())
                names.add(face.describe().to_string());
        }
        const fontNames = [...names].sort((a, b) => a.localeCompare(b));
        const searchNames = new Map(fontNames.map(name => [name, normalizeFontSearch(name)]));
        const search = new Gtk.SearchEntry({placeholder_text: _('Search fonts')});
        let query = '';
        const filter = Gtk.CustomFilter.new(item =>
            matchesFontSearch(searchNames.get(item.get_string()), query));
        const filtered = new Gtk.FilterListModel({
            model: Gtk.StringList.new(fontNames),
            filter,
        });
        const selection = new Gtk.SingleSelection({
            model: filtered,
            autoselect: false,
            can_unselect: true,
        });
        const currentIndex = fontNames.indexOf(currentFace);
        if (currentIndex >= 0)
            selection.set_selected(currentIndex);
        search.connect('search-changed', () => {
            query = normalizeFontSearch(search.get_text());
            filter.changed(Gtk.FilterChange.DIFFERENT);
        });

        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_factory, item) => item.set_child(new Gtk.Label({
            xalign: 0,
            margin_start: 8,
            margin_end: 8,
            margin_top: 4,
            margin_bottom: 4,
        })));
        factory.connect('bind', (_factory, item) =>
            item.get_child().set_label(item.get_item().get_string()));
        const list = new Gtk.ListView({model: selection, factory});
        list.connect('activate', (_list, position) => {
            selection.set_selected(position);
            dialog.response(Gtk.ResponseType.APPLY);
        });
        const scroll = new Gtk.ScrolledWindow({
            child: list,
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vexpand: true,
        });

        const box = dialog.get_content_area();
        box.set_spacing(8);
        box.append(search);
        box.append(scroll);
        const sizeLabel = new Gtk.Label({label: _('Font Size'), mnemonic_widget: size});
        const sizeRow = new Gtk.Box({spacing: 8, halign: Gtk.Align.END});
        sizeRow.append(sizeLabel);
        sizeRow.append(size);
        box.append(sizeRow);

        dialog.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.APPLY) {
                size.update();
                const selected = selection.get_selected_item();
                const font = selected
                    ? Pango.FontDescription.from_string(selected.get_string())
                    : current;
                font.set_size(Math.round(size.get_value() * Pango.SCALE));
                this._settings.set_string('font', font.to_string());
            }
            dialog.close();
        });
        dialog.present();
        if (currentIndex >= 0)
            list.scroll_to(currentIndex, Gtk.ListScrollFlags.NONE, null);
        search.grab_focus();
    }

    destroy() {
        for (let id of this._settingsSignalIds)
            this._settings.disconnect(id);
        this._settingsSignalIds = [];
        this._settings = null;
    }
}


export default class KimpanelExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        let widget = new KimpanelPrefsWidget(this.getSettings());
        window.add(widget);
        window.connect('close-request', () => widget.destroy());
    }
}
