import assert from "node:assert/strict";
import {
  coalesceResponsiveImageDependencies,
  isKnownNonWebsiteMedia
} from "../packages/business-data/generation-crawler";

const candidates = coalesceResponsiveImageDependencies([
  {
    url: "https://example.com/uploads/team-300x200.jpg?ver=1",
    role: "image",
    initiatorUrls: new Set(["https://example.com/"])
  },
  {
    url: "https://example.com/uploads/team-1200x800.jpg?ver=2",
    role: "image",
    initiatorUrls: new Set(["https://example.com/about"])
  },
  {
    url: "https://example.com/uploads/team.jpg",
    role: "image",
    initiatorUrls: new Set(["https://example.com/team"])
  },
  {
    url: "https://example.com/site.css?ver=1",
    role: "stylesheet",
    initiatorUrls: new Set(["https://example.com/"])
  }
]);

assert.equal(candidates.length, 2);
const image = candidates.find((candidate) => candidate.role === "image");
assert.equal(image?.url, "https://example.com/uploads/team.jpg");
assert.deepEqual([...image!.initiatorUrls].sort(), [
  "https://example.com/",
  "https://example.com/about",
  "https://example.com/team"
]);
assert.equal(isKnownNonWebsiteMedia("https://example.com/hero.mp4"), true);
assert.equal(isKnownNonWebsiteMedia("https://example.com/hero.webp"), false);

console.log("Generation dependency selection verification passed.");
