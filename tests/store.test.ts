import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { isSupabaseConfigured, setSupabaseConfiguredForTests } from "../src/auth/config.js";
import { signInBeside, sunArmed, useSiteStore } from "../src/state/store.js";

/** Read at import, before any test overrides it: node has no VITE_* settings. */
const configuredAtImport = isSupabaseConfigured();
const initial = useSiteStore.getState();

beforeEach(() => {
  useSiteStore.setState(initial, true);
  setSupabaseConfiguredForTests(true);
});

const store = () => useSiteStore.getState();

/** The overview at rest, as after its settle. */
function resting() {
  useSiteStore.setState({ view: "overview", moving: false, focused: null, seq: 3 });
}

/** A focused section at rest. */
function onSection() {
  useSiteStore.setState({ view: "saturn", focused: "saturn", moving: false, uiVisible: true, seq: 3 });
}

test("without Supabase settings the build is unconfigured", () => {
  assert.equal(configuredAtImport, false);
});

test("the sun is armed only on the resting overview, black hole off, with Supabase", () => {
  resting();
  assert.equal(sunArmed(store()), true);
  for (const [label, change] of [
    ["a section", { view: "sun" }],
    ["a flight", { moving: true }],
    ["no WebGL", { degraded: true }],
    ["collapsing", { blackHole: "collapsing" }],
    ["open", { blackHole: "open" }],
  ] as const) {
    assert.equal(sunArmed({ ...store(), ...change }), false, label);
  }
  setSupabaseConfiguredForTests(false);
  assert.equal(sunArmed(store()), false, "no Supabase");
});

test("a sun click opens the black hole once", () => {
  resting();
  useSiteStore.setState({ highlight: "sun", uiVisible: true });
  store().openBlackHole("sun");
  assert.partialDeepStrictEqual(store(), {
    view: "overview",
    viewSource: "user",
    seq: 4,
    highlight: null,
    moving: true,
    uiVisible: false,
    blackHole: "collapsing",
  });
  // A second click mid-collapse would restart the flight.
  store().openBlackHole("sun");
  assert.equal(store().seq, 4);
});

test("a sun click is ignored unless armed", () => {
  onSection();
  store().openBlackHole("sun");
  assert.equal(store().blackHole, "off");
  assert.equal(store().view, "saturn");
  assert.equal(store().seq, 3);
});

test("history opens the black hole from a section, but not twice", () => {
  onSection();
  useSiteStore.setState({ moving: true });
  store().openBlackHole("history");
  assert.equal(store().view, "overview");
  assert.equal(store().blackHole, "collapsing");
  assert.equal(store().seq, 4);
  store().openBlackHole("history");
  assert.equal(store().seq, 4);
});

test("history without a scene lands on the plain overview", () => {
  onSection();
  useSiteStore.setState({ degraded: true });
  store().openBlackHole("history");
  assert.equal(store().view, "overview");
  assert.equal(store().blackHole, "off");
  assert.equal(store().moving, false);
});

test("the black hole forms only while collapsing", () => {
  resting();
  store().blackHoleFormed();
  assert.equal(store().blackHole, "off");
  store().openBlackHole("sun");
  store().blackHoleFormed();
  assert.equal(store().blackHole, "open");
});

test("closing re-forms the sun with a flight; closed, it does nothing", () => {
  resting();
  store().openBlackHole("sun");
  store().blackHoleFormed();
  useSiteStore.setState({ moving: false, uiVisible: true });
  store().closeBlackHole();
  assert.equal(store().blackHole, "off");
  assert.equal(store().view, "overview");
  assert.equal(store().seq, 5);
  assert.equal(store().moving, true);
  assert.equal(store().uiVisible, false);
  store().closeBlackHole();
  assert.equal(store().seq, 5);
});

test("navigating to the overview closes the black hole; at rest it is a no-op", () => {
  resting();
  store().navigate("overview");
  assert.equal(store().seq, 3);
  assert.equal(store().moving, false);

  store().openBlackHole("sun");
  store().blackHoleFormed();
  store().navigate("overview");
  assert.equal(store().blackHole, "off");
  assert.equal(store().seq, 5);
});

test("a tab while open flies to its section and turns the black hole off", () => {
  resting();
  store().openBlackHole("sun");
  store().navigate("sun");
  assert.equal(store().view, "sun");
  assert.equal(store().blackHole, "off");
});

test("scrolling never changes the view under the black hole", () => {
  for (const blackHole of ["collapsing", "open"] as const) {
    useSiteStore.setState(initial, true);
    useSiteStore.setState({ view: "overview", blackHole, moving: true });
    store().setViewFromScroll("saturn");
    assert.equal(store().view, "overview", blackHole);
    assert.equal(store().focused, null, blackHole);
    assert.equal(store().blackHole, blackHole);
  }
  useSiteStore.setState(initial, true);
  store().setViewFromScroll("saturn");
  assert.equal(store().view, "saturn");
});

test("without Supabase the sun is inert and history lands on the overview", () => {
  setSupabaseConfiguredForTests(false);
  resting();
  store().openBlackHole("sun");
  assert.equal(store().blackHole, "off");
  assert.equal(store().seq, 3);

  onSection();
  store().openBlackHole("history");
  assert.equal(store().view, "overview");
  assert.equal(store().blackHole, "off");
  // An ordinary return flight.
  assert.equal(store().moving, true);
  assert.equal(store().seq, 4);
});

test("the sign-in sits beside the black hole except on upright phones", () => {
  assert.equal(signInBeside({ isMobile: false, shortLandscape: false }), true);
  assert.equal(signInBeside({ isMobile: false, shortLandscape: true }), true);
  assert.equal(signInBeside({ isMobile: true, shortLandscape: true }), true);
  assert.equal(signInBeside({ isMobile: true, shortLandscape: false }), false);
});
