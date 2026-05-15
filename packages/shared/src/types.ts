export interface Faction {
  slug: string;
  name: string;
  description?: string;
  ideology?: string;
}

export interface Account {
  handle: string;
  faction: string;
  display_name?: string;
  notes?: string;
}

export interface Taxonomy {
  factions: Faction[];
  accounts: Account[];
}

export interface NarrativeSignal {
  id: string;
  title: string;
  summary: string;
  factionSlug: string;
  confidence: number;
  evidenceTweetIds: string[];
  detectedAt: string;
}
