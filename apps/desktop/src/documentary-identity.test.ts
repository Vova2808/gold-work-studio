import assert from "node:assert/strict";
import test from "node:test";
import type { Scene } from "@gold-work/shared";
import { documentaryCatalogIdentityConflict, documentaryIdentityReviewIssue, documentarySavedIdentityIssue, documentaryGeneralActionIssue, documentaryProjectionIssue, documentaryListsNamedSubjects } from "./documentary-visual-relevance.js";

const scene = { narration: "затем снова опускается к океану.", documentary: { verified: true, requirement: {
  text: "затем снова опускается к океану.", entities: ["шлюз", "Панамский канал"], years: [], queries: [],
  identities: [{ name: "Панамский канал", aliases: ["Panama Canal"] }]
}, visualReview: { reason: "This is Moscow Canal footage, not Panama Canal, but entities list includes generic 'шлюз' (lock) which is satisfied." } } } as unknown as Scene;
const segment = { id: 15, start: 10, end: 20, sample: 15, description: "", entities: ["Panama Canal"], camera: true, usable: true };

test('a confirmed rider plus his vehicle is not rejected for the wording of the name', () => {
  const requirement={...scene.documentary!.requirement,identities:[{name:'Valentino Rossi',aliases:['Rossi']}]};
  for(const identifiedEntity of ['Valentino Rossi on Yamaha','Valentino Rossi, Yamaha','Rossi riding Yamaha'])
    assert.equal(documentaryIdentityReviewIssue(requirement,{identityMatch:true,identifiedEntity}),undefined);
  for(const identifiedEntity of ['Valentino Rossini','Not Valentino Rossi','Possibly Valentino Rossi','Rossi replica'])
    assert.ok(documentaryIdentityReviewIssue(requirement,{identityMatch:true,identifiedEntity}));
  assert.ok(documentaryIdentityReviewIssue(requirement,{identityMatch:false,identifiedEntity:'Valentino Rossi on Yamaha'}));
  const model={...requirement,identities:[{name:'Yamaha M1',aliases:[]}]};
  assert.ok(documentaryIdentityReviewIssue(model,{identityMatch:true,identifiedEntity:'Yamaha M1000'}));
});

test("explicit named lists allow one illustration, while relations and contextual identity pairs do not", () => {
  const identities = [{ name: "Агуа-Клара", aliases: ["Agua Clara Locks"] }, { name: "Коколи", aliases: ["Cocoli Locks"] }];
  assert.equal(documentaryListsNamedSubjects({ text: "Новые комплексы Агуа-Клара и Коколи ", identities }), true);
  assert.equal(documentaryListsNamedSubjects({ text: "Agua Clara Locks and Cocoli Locks opened.", identities }), true);
  assert.equal(documentaryListsNamedSubjects({ text: "Маршрут между Агуа-Клара и Коколи", identities }), false);
  assert.equal(documentaryListsNamedSubjects({ text: "Агуа-Клара и Коколи", detail: "Comparison of the two facilities", identities }), false);
  assert.equal(documentaryListsNamedSubjects({ text: "Agua Clara Locks and Cocoli Locks", detail: "connecting the two places", identities }), false);
  assert.equal(documentaryListsNamedSubjects({ text: "Вода из озера наполняет камеры", identities }), false);
});

test("flat automatic montage rejects spherical video, preserves manual choices and ordinary model numbers", () => {
  for (const title of ["Panama Canal | Agua Clara Locks | 360º Video | Time Lapse", "360° camera footage", "360 video", "Equirectangular canal", "Dual-fisheye clip"]) {
    assert.ok(documentaryProjectionIssue({ kind: "video", title }));
    const saved = { ...scene, documentary: { ...scene.documentary!, selected: { kind: "video", title } } } as Scene;
    assert.ok(documentarySavedIdentityIssue(saved));
    assert.equal(documentarySavedIdentityIssue({ ...saved, documentary: { ...saved.documentary!, pinned: true } }), undefined);
  }
  assert.equal(documentaryProjectionIssue({ kind: "video", title: "Airbus A360 landing" }), undefined);
  assert.equal(documentaryProjectionIssue({ kind: "video", title: "360 ships pass the canal" }), undefined);
  assert.equal(documentaryProjectionIssue({ kind: "image", title: "360 degree rotation diagram" }), undefined);
});

test("translated catalog identity matches, while the generic lock cannot allow another named canal", () => {
  assert.equal(documentaryCatalogIdentityConflict(scene, segment, [segment]), false);
  assert.equal(documentaryCatalogIdentityConflict(scene, { ...segment, entities: ["Moscow Canal", "шлюз"] }, []), true);
  assert.ok(documentaryIdentityReviewIssue(scene.documentary!.requirement, { status: "accepted", identityMatch: true, identifiedEntity: "шлюз" }));
  assert.ok(documentaryIdentityReviewIssue(scene.documentary!.requirement, { identityMatch: false, identifiedEntity: "Panama Canal" }));
  assert.equal(documentaryIdentityReviewIssue(scene.documentary!.requirement, { identityMatch: true, identifiedEntity: "Panama Canal" }), undefined);
});

test("old explicit wrong-place approval is invalidated without touching unrelated approvals or manual pins", () => {
  assert.ok(documentarySavedIdentityIssue(scene));
  assert.equal(documentarySavedIdentityIssue({ ...scene, documentary: { ...scene.documentary!, pinned: true } }), undefined);
  assert.equal(documentarySavedIdentityIssue({ ...scene, documentary: { ...scene.documentary!, visualReview: { ...scene.documentary!.visualReview!, reason: "Clean aerial camera footage of Lake Gatun, which forms part of the Panama Canal waterway." } } }), undefined);
});

test("aliases work for other topics and retain exact model identity", () => {
  const vessel = { ...scene, documentary: { ...scene.documentary!, requirement: { ...scene.documentary!.requirement, entities: ["Титаник"], identities: [{ name: "Титаник", aliases: ["RMS Titanic", "Titanic"] }] } } };
  assert.equal(documentaryCatalogIdentityConflict(vessel, { ...segment, entities: ["RMS Titanic"] }, []), false);
  assert.equal(documentaryCatalogIdentityConflict(vessel, { ...segment, entities: ["RMS Olympic"] }, []), true);
});

test("an admitted general view cannot replace dredging or opening gates, while dimensions and manual pins remain valid", () => {
  const dredging = { ...scene, narration: "Земснаряды убирают отложения,", documentary: { ...scene.documentary!, visualReview: { ...scene.documentary!.visualReview!, reason: "Общий план вместо конкретной детали. Wide lake with distant ships." } } };
  assert.ok(documentarySavedIdentityIssue(dredging));
  assert.equal(documentarySavedIdentityIssue({ ...dredging, documentary: { ...dredging.documentary, visualReview: { ...dredging.documentary.visualReview, actionMatch: true, actionEvidence: "Readable dredger with working sediment pipe; actual detail proof overrides the coarse catalog label." } } }), undefined);
  assert.equal(documentarySavedIdentityIssue({ ...dredging, documentary: { ...dredging.documentary, pinned: true } }), undefined);
  assert.ok(documentaryGeneralActionIssue({ ...scene, narration: "За кормой закрываются ворота." }));
  assert.ok(documentaryGeneralActionIssue({ ...scene, narration: "The dredger removes sediment." }));
  assert.equal(documentaryGeneralActionIssue({ ...scene, narration: "Нельзя открыть проход между камерами." }), undefined);
  assert.equal(documentarySavedIdentityIssue({ ...dredging, narration: "Его длина около 80 километров." }), undefined);
});

test("explicit narrated-subject contradiction overrides an accepted location, including saved automatic approval", () => {
  const reason = 'Note: vessel appears to be car carrier/RoRo type rather than container ship as narrated, based on smooth hull design without visible container stacks.';
  const review = { status: 'accepted', confidence: .95, identityMatch: true, identifiedEntity: 'Panama Canal', reason };
  assert.ok(documentaryIdentityReviewIssue(scene.documentary!.requirement, review));
  const saved = { ...scene, documentary: { ...scene.documentary!, visualReview: { ...scene.documentary!.visualReview!, reason } } };
  assert.ok(documentarySavedIdentityIssue(saved));
  assert.equal(documentarySavedIdentityIssue({ ...saved, documentary: { ...saved.documentary!, pinned: true } }), undefined);
  assert.equal(documentaryIdentityReviewIssue(scene.documentary!.requirement, { ...review, reason: 'The infrastructure supports a canal transit rather than open sea or generic port.' }), undefined);
});
