import { createClient } from '@supabase/supabase-js';
import { defaultCharacters } from '../src/data/characters.js';

const supabase = createClient(
  'https://kzrczvjetydzgdmhjppk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6cmN6dmpldHlkemdkbWhqcHBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NTYyMzIsImV4cCI6MjA4NzUzMjIzMn0.3EY2W10NUssTrRbovI3rBJXgwxxWmwAobRxAeMTHeqU'
);

const legoChars = defaultCharacters.filter(c => c.franchise === 'lego');

for (const char of legoChars) {
  const row = {
    id: char.id,
    name: char.name,
    franchise: char.franchise,
    image: char.image,
    description: char.description,
    greeting: char.greeting,
    voice_name: char.voiceName,
    system_prompt: char.systemPrompt,
    is_custom: false,
  };
  const { error } = await supabase.from('characters').upsert(row, { onConflict: 'id' });
  if (error) console.error(`Failed ${char.id}:`, error.message);
  else console.log(`✅ ${char.name}`);
}
