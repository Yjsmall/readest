import React, { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { BoxedList, SettingsSwitchRow, NavigationRow } from '@/components/settings/primitives';
import { getVocabularyOptions, VOCABULARY_FIELDS } from '@/utils/contextVocabulary';
import type { ContextVocabularySettings } from '@/types/settings';
import VocabularyPromptEditor from './VocabularyPromptEditor';

const VocabularySettings: React.FC<{ bookKey: string; word?: string; context?: string }> = ({
  bookKey,
  word,
  context,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setRequestedPanel, setSettingsDialogBookKey, setSettingsDialogOpen } =
    useSettingsStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const options = getVocabularyOptions(settings.contextVocabulary);

  const savePreferences = async (patch: Partial<ContextVocabularySettings>) => {
    const store = useSettingsStore.getState();
    const previous = store.settings.contextVocabulary;
    const next = {
      ...store.settings,
      contextVocabulary: { ...getVocabularyOptions(previous), ...previous, ...patch },
    };
    setSaving(true);
    setError(false);
    store.setSettings(next);
    try {
      await store.saveSettings(envConfig, next);
    } catch {
      const latest = useSettingsStore.getState();
      latest.setSettings({ ...latest.settings, contextVocabulary: previous });
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className='min-h-0 flex-1 space-y-4 overflow-y-auto pb-2'
      role='tabpanel'
      id='vocabulary-configuration'
      aria-labelledby='vocabulary-configuration-tab'
    >
      <BoxedList title={_('Card content')}>
        {VOCABULARY_FIELDS.map(({ key, label }) => (
          <SettingsSwitchRow
            key={key}
            label={_(label)}
            checked={options[key]}
            disabled={saving}
            onChange={() => void savePreferences({ [key]: !options[key] })}
          />
        ))}
      </BoxedList>
      <VocabularyPromptEditor
        word={word}
        context={context}
        prompts={settings.contextVocabulary?.prompts}
        saving={saving}
        onSave={(field, template) => {
          const prompts = { ...useSettingsStore.getState().settings.contextVocabulary?.prompts };
          const fallback = VOCABULARY_FIELDS.find(({ key }) => key === field)!.instruction;
          if (template === fallback) delete prompts[field];
          else prompts[field] = template;
          return savePreferences({ prompts });
        }}
      />
      {error && (
        <p role='alert' className='text-error text-sm'>
          {_('Could not save vocabulary settings')}
        </p>
      )}
      <BoxedList>
        <NavigationRow
          title={_('AI Settings')}
          onClick={() => {
            setSettingsDialogBookKey(bookKey);
            setRequestedPanel('AI');
            setSettingsDialogOpen(true);
          }}
        />
      </BoxedList>
    </div>
  );
};

export default VocabularySettings;
