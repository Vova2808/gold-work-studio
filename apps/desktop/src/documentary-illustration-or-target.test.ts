import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryIllustrationQualityIssue,documentarySavedIllustrationQualityIssue} from './documentary-illustration-quality.js';

const internalTarget='Preserved ship iron frame interior';
const enclosureTarget='Glass enclosure around the preserved ship';
const enclosure={description:'The glass and steel framing of the museum enclosure surrounds the preserved ship.',
  suitable:true,targetVisible:true,targetEvidence:'The museum glass enclosure around the ship is visible.',
  sourceText:{kind:'none',text:''}};

test('an explicit OR enclosure alternative does not inherit the other alternative\'s internal-frame requirement',()=>{
  for(const target of [`${internalTarget} OR ${enclosureTarget}`,`${enclosureTarget} OR ${internalTarget}`,
    `${internalTarget} or ${enclosureTarget}`]){
    assert.equal(documentaryIllustrationQualityIssue(target,enclosure,true),undefined,target);
    assert.equal(documentarySavedIllustrationQualityIssue(target,{
      status:'accepted',confidence:1,reason:'The enclosure alternative is visible.',quality:'',checkedAt:'now',sampleSeconds:[0],
      viewDescription:enclosure.description,illustrationQualityVersion:1,
      targetVisibility:{version:1,target,visible:true,evidence:enclosure.targetEvidence},
      sourceText:{version:1,kind:'none',text:''},
    }),undefined,'Saved approval preserves the same complete OR task');
  }
});

test('an enclosure still cannot satisfy a mandatory internal frame or two internal-frame alternatives',()=>{
  for(const target of [internalTarget,`${internalTarget} AND ${enclosureTarget}`,
    `${internalTarget} OR preserved aircraft iron frame interior`])
    assert.equal(documentaryIllustrationQualityIssue(target,enclosure,true)?.status,'uncertain',target);
});

test('OR alternatives do not bypass missing pixel proof or presentation quality',()=>{
  const target=`${internalTarget} OR ${enclosureTarget}`;
  assert.equal(documentaryIllustrationQualityIssue(target,{...enclosure,targetVisible:false},true)?.status,'rejected');
  assert.equal(documentaryIllustrationQualityIssue(target,{...enclosure,targetEvidence:undefined},true)?.status,'uncertain');
  assert.equal(documentaryIllustrationQualityIssue(target,{...enclosure,sourceText:{kind:'promotion',text:'Subscribe now'}},true)?.status,'rejected');
  assert.equal(documentaryIllustrationQualityIssue(target,{...enclosure,sourceText:{kind:'caption',text:'Unrelated movie',relevant:false}},true)?.status,'rejected');
});
