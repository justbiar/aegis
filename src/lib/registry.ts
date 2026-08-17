export interface RegistryEntry {
  repo_url: string;
  telegram: string[];
  name?: string;
  one_liner?: string;
  slug?: string;
  category?: string;
}

const REGISTRY_URL =
  "https://raw.githubusercontent.com/starkience/strk20-hackathon/main/registry.json";

export async function fetchRegistry(): Promise<RegistryEntry[]> {
  const res = await fetch(REGISTRY_URL, { next: { revalidate: 1800 } });
  if (!res.ok) {
    throw new Error(`Failed to fetch registry.json: ${res.status}`);
  }
  return res.json();
}
