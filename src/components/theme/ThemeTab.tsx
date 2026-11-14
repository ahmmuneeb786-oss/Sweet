import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Copy, Paintbrush, Palette, Pencil, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useNotify } from '../../contexts/NotificationContext';
import { localDB } from '../../db';
import { useTheme } from '../../theme/ThemeProvider';
import { themeDataFor, type ActiveTheme } from '../../theme/cache';
import { resolveTheme } from '../../theme/derive';
import { APP_PRESETS, getAppPreset, type AppPreset } from '../../theme/presets';
import { MAX_NAME, MAX_THEMES, ThemeLimitError, themeActions, themeLibrary, type UserTheme } from '../../theme/store';
import type { ThemeData } from '../../theme/tokens';
import { TastePreview } from './TastePreview';
import { ThemeEditor, type EditorInit } from './ThemeEditor';
import { SheetAction, ThemeSheet } from './ThemeSheet';
import { ThemeSwatch } from './ThemeSwatch';

type MenuTarget = { type: 'preset'; preset: AppPreset } | { type: 'custom'; theme: UserTheme };

const sameTheme = (a: ActiveTheme | null, b: ActiveTheme | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;

const asActive = (t: UserTheme): ActiveTheme => ({ kind: 'custom', id: t.id, name: t.name, data: t.data });

function nameOf(t: ActiveTheme): string {
  return t.kind === 'custom' ? t.name : getAppPreset(t.id)?.name ?? 'Sweet';
}

/** "Cotton Candy remix", then "Cotton Candy remix 2", … within the name limit. */
function uniqueName(base: string, taken: string[]): string {
  const clip = (s: string) => s.slice(0, MAX_NAME);
  if (!taken.includes(clip(base))) return clip(base);
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, MAX_NAME - suffix.length) + suffix;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Name of the person in the user's most recent (unlocked) chat, for the preview. */
function usePreviewPartner(): string {
  const [name, setName] = useState('Sweetheart');
  useEffect(() => {
    let cancelled = false;
    localDB.chats
      .toArray()
      .then((chats) => {
        const recent = chats
          .filter((c) => !c.is_locked && c.type === 'direct' && c.other_user_name)
          .sort((a, b) => (b.last_message_time ?? '').localeCompare(a.last_message_time ?? ''))[0];
        if (recent?.other_user_name && !cancelled) setName(recent.other_user_name);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return name;
}

export function ThemeTab({ onBack }: { onBack: () => void }) {
  const { active, setActive, library } = useTheme();
  const { showSuccess, showError } = useNotify();
  const confirm = useConfirm();

  // draft = picked but not served yet; hover = desktop "taste" on mouse-over.
  const [draft, setDraft] = useState<ActiveTheme | null>(null);
  const [hover, setHover] = useState<ActiveTheme | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [renaming, setRenaming] = useState<UserTheme | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [editor, setEditor] = useState<EditorInit | null>(null);

  const partner = usePreviewPartner();

  const shown = hover ?? draft ?? active;
  const shownTokens = useMemo(() => resolveTheme(themeDataFor(shown)), [shown]);
  const presetTokens = useMemo(() => Object.fromEntries(APP_PRESETS.map((p) => [p.id, resolveTheme(p.data)])), []);
  const customTokens = useMemo(
    () => Object.fromEntries(library.themes.map((t) => [t.id, resolveTheme(t.data)])),
    [library.themes],
  );

  // A draft for a theme deleted meanwhile (e.g. on another device) is dropped.
  useEffect(() => {
    if (draft?.kind === 'custom' && library.loaded && !library.themes.some((t) => t.id === draft.id)) setDraft(null);
  }, [draft, library]);

  const select = (t: ActiveTheme) => setDraft(sameTheme(t, active) ? null : t);
  const hoverOn = (t: ActiveTheme) => (on: boolean) => setHover(on ? t : null);

  const serve = useCallback(() => {
    if (!draft) return;
    setActive(draft);
    setDraft(null);
    setHover(null);
    showSuccess(`🍭 ${nameOf(draft)} served!`);
  }, [draft, setActive, showSuccess]);

  const handleBack = () => (draft ? setLeaving(true) : onBack());

  const saveCopy = (name: string, data: ThemeData, basedOn: string | null) => {
    try {
      const created = themeActions.createTheme({
        name: uniqueName(name, library.themes.map((t) => t.name)),
        data,
        based_on: basedOn,
      });
      setDraft(asActive(created));
      showSuccess(`Saved “${created.name}” to My themes`);
    } catch (err) {
      showError(err instanceof ThemeLimitError ? err.message : "Couldn't save the theme");
    }
  };

  const takenNames = () => library.themes.map((t) => t.name);
  const atLimit = library.themes.length >= MAX_THEMES;

  /** Preset → open the editor on an unsaved copy. Own theme → save a copy now. */
  const remix = (target: MenuTarget) => {
    setMenu(null);
    if (target.type === 'preset') {
      if (atLimit) return showError(new ThemeLimitError().message);
      setEditor({ name: uniqueName(`${target.preset.name} remix`, takenNames()), data: target.preset.data, basedOn: target.preset.id });
    } else {
      saveCopy(`${target.theme.name} copy`, target.theme.data, target.theme.based_on);
    }
  };

  /** "+ New theme": starts from whatever the preview shows right now. */
  const startNew = () => {
    if (atLimit) return showError(new ThemeLimitError().message);
    const base = draft ?? active;
    setEditor({ name: uniqueName('My theme', takenNames()), data: themeDataFor(base), basedOn: base.kind === 'preset' ? base.id : null });
  };

  const edit = (t: UserTheme) => {
    setMenu(null);
    setEditor({ id: t.id, name: t.name, data: t.data, basedOn: t.based_on });
  };

  /** Called by the editor. Returns false (editor stays open) if it couldn't save. */
  const saveFromEditor = (init: EditorInit, name: string, data: ThemeData, use: boolean): boolean => {
    let saved: UserTheme | undefined;
    if (init.id) {
      themeActions.updateTheme(init.id, { name, data });
      saved = themeLibrary.get().themes.find((t) => t.id === init.id);
    } else {
      try {
        saved = themeActions.createTheme({ name: uniqueName(name, takenNames()), data, based_on: init.basedOn });
      } catch (err) {
        showError(err instanceof ThemeLimitError ? err.message : "Couldn't save the theme");
        return false;
      }
    }
    if (!saved) return false;
    const a = asActive(saved);
    if (use) {
      setActive(a);
      setDraft(null);
      showSuccess(`🍭 ${saved.name} saved and served!`);
    } else {
      // Editing the theme in use updates the app by itself; otherwise show it ready to serve.
      setDraft(sameTheme(a, active) ? null : a);
      showSuccess(`Saved “${saved.name}”`);
    }
    return true;
  };

  const startRename = (t: UserTheme) => {
    setMenu(null);
    setRenameValue(t.name);
    setRenaming(t);
  };

  const finishRename = () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (name && name !== renaming.name) themeActions.updateTheme(renaming.id, { name });
    if (draft?.kind === 'custom' && draft.id === renaming.id && name) setDraft({ ...draft, name: name.slice(0, MAX_NAME) });
    setRenaming(null);
  };

  const remove = async (t: UserTheme) => {
    setMenu(null);
    const inUse = active.kind === 'custom' && active.id === t.id;
    const chats = Object.values(library.overrides).filter((o) => o.kind === 'custom' && o.id === t.id).length;
    const notes = [
      inUse && 'It’s your current theme, so the app will switch back to its preset.',
      chats > 0 && `${chats} chat${chats === 1 ? '' : 's'} keep a copy of its colours.`,
    ].filter(Boolean);
    const ok = await confirm({
      title: `Delete “${t.name}”?`,
      message: ['This can’t be undone.', ...notes].join(' '),
      danger: true,
    });
    if (!ok) return;
    themeActions.deleteTheme(t.id);
    if (draft?.kind === 'custom' && draft.id === t.id) setDraft(null);
    showSuccess(`Deleted “${t.name}”`);
  };

  const sectionLabel = 'text-[10px] font-bold uppercase tracking-[0.2em] text-th-ink-soft';

  if (editor) {
    return (
      <ThemeEditor
        key={editor.id ?? 'new'}
        init={editor}
        partner={partner}
        onSave={(name, data, use) => saveFromEditor(editor, name, data, use)}
        onClose={() => setEditor(null)}
      />
    );
  }

  return (
    <div className="min-h-full bg-th-panel text-th-ink candy-fade-in">
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <button onClick={handleBack} className="flex items-center gap-1.5 text-sm font-medium text-th-link hover:opacity-80 transition-opacity">
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <span className={sectionLabel}>Theme 🎨</span>
        </div>

        {/* Taste Test — stays in view on tall (desktop) panels. */}
        <div className="md:sticky md:top-0 md:z-10 md:-mx-6 md:px-6 md:pt-1 md:pb-2 md:bg-th-panel">
          <TastePreview
            tokens={shownTokens}
            otherName={partner}
            caption={
              hover && !sameTheme(hover, draft ?? active) ? `Tasting · ${nameOf(hover)}`
              : draft ? `Tasting · ${nameOf(draft)}`
              : `In use · ${nameOf(active)}`
            }
          />
        </div>

        {/* My themes */}
        <section className="space-y-3" aria-labelledby="my-themes">
          <div className="flex items-baseline justify-between">
            <h3 id="my-themes" className={sectionLabel}>My themes</h3>
            {library.themes.length > 0 && (
              <span className="text-[10px] font-bold text-th-ink-faint">{library.themes.length}/{MAX_THEMES}</span>
            )}
          </div>
          {library.themes.length === 0 ? (
            <button
              type="button"
              onClick={startNew}
              className="w-full rounded-2xl border-2 border-dashed border-th-border p-4 flex items-center gap-3 text-left hover:border-th-primary/60 hover:bg-th-card/50 transition-colors"
            >
              <Wand2 className="w-5 h-5 shrink-0 text-th-link" aria-hidden="true" />
              <span className="text-xs text-th-ink-soft">
                <b className="block text-sm text-th-ink">Create your own theme</b>
                Pick every colour yourself — or tap ⋯ on a preset to remix it.
              </span>
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {library.themes.map((t) => {
                const a = asActive(t);
                return (
                  <ThemeSwatch
                    key={t.id}
                    name={t.name}
                    tokens={customTokens[t.id]}
                    inUse={sameTheme(a, active)}
                    tasting={sameTheme(a, draft)}
                    onSelect={() => select(a)}
                    onHover={hoverOn(a)}
                    onMore={() => setMenu({ type: 'custom', theme: t })}
                  />
                );
              })}
              {!atLimit && (
                <button
                  type="button"
                  onClick={startNew}
                  className="rounded-2xl border-2 border-dashed border-th-border min-h-[118px] flex flex-col items-center justify-center gap-1.5 text-th-ink-soft hover:border-th-primary/60 hover:text-th-link hover:bg-th-card/50 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  <span className="text-xs font-bold">New theme</span>
                </button>
              )}
            </div>
          )}
        </section>

        {/* Presets */}
        <section className="space-y-3" aria-labelledby="presets">
          <h3 id="presets" className={sectionLabel}>Presets</h3>
          <div className="grid grid-cols-2 gap-3">
            {APP_PRESETS.map((p) => {
              const a: ActiveTheme = { kind: 'preset', id: p.id };
              return (
                <ThemeSwatch
                  key={p.id}
                  name={p.name}
                  emoji={p.emoji}
                  tokens={presetTokens[p.id]}
                  inUse={sameTheme(a, active)}
                  tasting={sameTheme(a, draft)}
                  onSelect={() => select(a)}
                  onHover={hoverOn(a)}
                  onMore={() => setMenu({ type: 'preset', preset: p })}
                />
              );
            })}
          </div>
          <p className="text-[11px] text-th-ink-faint text-center">Tap to taste · ⋯ to remix</p>
        </section>
      </div>

      {/* Serve bar — only while something is being tasted. */}
      {draft && (
        <div className="sticky bottom-0 z-10 px-6 py-3 bg-th-panel/95 border-t border-th-border flex items-center gap-3 sheet-up">
          <button onClick={() => setDraft(null)} className="px-4 py-2.5 rounded-2xl text-sm font-bold bg-th-secondary text-th-on-secondary hover:bg-th-card-hover transition-colors">
            Reset
          </button>
          <button onClick={serve} className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-black bg-th-primary text-th-on-primary shadow-md hover:opacity-90 transition-opacity">
            Serve it 🍭
          </button>
        </div>
      )}

      {/* Card menu */}
      {menu && (
        <ThemeSheet
          title={menu.type === 'preset' ? `${menu.preset.emoji} ${menu.preset.name}` : menu.theme.name}
          subtitle={menu.type === 'preset' ? 'Built-in theme' : 'One of your themes'}
          onClose={() => setMenu(null)}
        >
          <div className="space-y-2">
            <SheetAction
              primary
              icon={<Sparkles className="w-4 h-4" />}
              label="Use this theme"
              onClick={() => {
                const a = menu.type === 'preset' ? { kind: 'preset' as const, id: menu.preset.id } : asActive(menu.theme);
                setMenu(null);
                setActive(a);
                setDraft(null);
                showSuccess(`🍭 ${nameOf(a)} served!`);
              }}
            />
            {menu.type === 'custom' && (
              <SheetAction icon={<Palette className="w-4 h-4" />} label="Edit colours" hint="Change any colour, in Simple or Advanced" onClick={() => edit(menu.theme)} />
            )}
            <SheetAction
              icon={menu.type === 'preset' ? <Paintbrush className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              label={menu.type === 'preset' ? 'Remix' : 'Duplicate'}
              hint={menu.type === 'preset' ? 'Start your own theme from this one' : 'Save another copy'}
              onClick={() => remix(menu)}
            />
            {menu.type === 'custom' && (
              <>
                <SheetAction icon={<Pencil className="w-4 h-4" />} label="Rename" onClick={() => startRename(menu.theme)} />
                <SheetAction danger icon={<Trash2 className="w-4 h-4" />} label="Delete" onClick={() => void remove(menu.theme)} />
              </>
            )}
          </div>
        </ThemeSheet>
      )}

      {/* Rename */}
      {renaming && (
        <ThemeSheet title="Rename theme" onClose={() => setRenaming(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); finishRename(); }}
          >
            <input
              autoFocus
              value={renameValue}
              maxLength={MAX_NAME}
              onChange={(e) => setRenameValue(e.target.value)}
              aria-label="Theme name"
              className="w-full rounded-2xl px-4 py-3 text-sm bg-th-input border border-th-border text-th-ink outline-none focus:ring-2 focus:ring-th-primary"
            />
            <div className="flex items-center justify-between text-[11px] text-th-ink-faint">
              <span>{renameValue.trim() ? '' : 'Give it a name'}</span>
              <span>{renameValue.length}/{MAX_NAME}</span>
            </div>
            <button
              type="submit"
              disabled={!renameValue.trim()}
              className="w-full rounded-2xl py-3 text-sm font-black bg-th-primary text-th-on-primary disabled:opacity-40"
            >
              Save name
            </button>
          </form>
        </ThemeSheet>
      )}

      {/* Leaving with a theme picked but not served */}
      {leaving && draft && (
        <ThemeSheet
          title={`Serve ${nameOf(draft)}?`}
          subtitle="You picked a theme but haven’t applied it yet."
          onClose={() => setLeaving(false)}
        >
          <div className="space-y-2">
            <SheetAction primary label="Serve it 🍭" onClick={() => { serve(); setLeaving(false); onBack(); }} />
            <SheetAction label="Discard" hint={`Keep ${nameOf(active)}`} onClick={() => { setDraft(null); setLeaving(false); onBack(); }} />
            <SheetAction label="Keep looking" onClick={() => setLeaving(false)} />
          </div>
        </ThemeSheet>
      )}
    </div>
  );
}
