import type {
  CandidateSource,
  FeatureVector,
  ModelWeights,
  ProfileData,
  TagVector,
} from "../types";
import { contributions } from "./model";
import { sharedTags } from "./tags";

export interface ExplainInput {
  features: FeatureVector;
  weights: ModelWeights;
  sources: CandidateSource[];
  tags: TagVector;
  profile: ProfileData;
  releaseYear: number | null;
}

/** Up to three human-readable reasons, derived from the largest positive score contributions. */
export function explain(input: ExplainInput): string[] {
  const reasons: string[] = [];
  const push = (r: string | null | undefined) => {
    if (r && !reasons.includes(r) && reasons.length < 3) reasons.push(r);
  };
  const best = (type: CandidateSource["type"]) =>
    input.sources.filter((s) => s.type === type).sort((a, b) => b.score - a.score)[0];

  for (const [feature, value] of contributions(input.weights, input.features)) {
    if (value <= 0.05) break;
    switch (feature) {
      case "d:tagSim": {
        const shared = sharedTags(input.tags, input.profile.tags, 3);
        if (shared.length) push(`Matches your taste in ${shared.join(", ")}`);
        break;
      }
      case "d:trackSim": {
        const s = best("similar-track");
        if (s?.seedLabel) push(`Similar to “${s.seedLabel}”, which you love`);
        break;
      }
      case "d:graph": {
        const s = best("similar-artist") ?? best("radio");
        push(s?.seedLabel ? `Fans of ${s.seedLabel} listen to this` : "Close to artists you love");
        break;
      }
      case "d:artist": {
        const s = best("deep-cut");
        push(s?.seedLabel ? `A deeper cut from ${s.seedLabel}` : "From an artist you already like");
        break;
      }
      case "d:consensus":
        push("Several of your favourites point here");
        break;
      case "d:era":
        if (input.releaseYear)
          push(`From the ${Math.floor(input.releaseYear / 10) * 10}s, an era you play a lot`);
        break;
      default:
        if (feature.startsWith("t:") && value > 0.15)
          push(`You've been liking ${feature.slice(2)} lately`);
        else if (feature.startsWith("a:") && value > 0.3) push("You liked this artist on Spoter");
    }
  }
  const tag = best("tag");
  if (reasons.length < 2 && tag?.seedLabel) push(`A top ${tag.seedLabel} track`);
  if (reasons.length === 0) push("Something new to calibrate your taste");
  return reasons;
}
