import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pictureClipped, geometryProblems, diagramChanges} from './dsa-geometry.mjs';
const panel={left:16,right:374,top:0,bottom:280,height:280};
// Actual dimensions reported for the phone merge-sort call tree.
const wide=()=>({left:26.6,right:544.6,width:518,height:300,contentLeft:0,contentRight:518,
  view:{left:26.6,right:363.4,width:336.8,scrollWidth:518,overflowX:'auto'}});
const dwell=()=>({dg:panel,svgs:[wide()],overflow:0,vh:844,win:{top:288,bottom:724},bar:{top:732,bottom:810},line:{top:640,bottom:703}});
test('a readable wide call tree is reachable through its figure scrollport',()=>{
 assert.equal(pictureClipped(wide(),panel),false);
 const scrolled=wide();scrolled.left-=181.2;scrolled.right-=181.2;
 assert.equal(pictureClipped(scrolled,panel),false);
});
test('the same wide picture clipped by hidden or clip overflow fails',()=>{
 for(const overflowX of ['hidden','clip','visible']){const g=wide();g.view.overflowX=overflowX;assert.equal(pictureClipped(g,panel),true);}
});
test('scrolling cannot excuse unreachable drawing, a collapsed SVG or an overflowing figure',()=>{
 for(const mutate of [g=>g.width=0,g=>g.height=0,g=>g.contentRight=600,g=>g.contentLeft=-30,g=>g.view.right=500,g=>g.view.width=0]){
  const g=wide();mutate(g);assert.equal(pictureClipped(g,panel),true);
 }
});
test('a contained non-scrollable picture is valid',()=>{
 const g=wide();g.width=200;g.right=g.left+200;g.view.overflowX='hidden';assert.equal(pictureClipped(g,panel),false);
});
test('pre-glide viewport failure and settled execution geometry are distinguished',()=>{
 const s=dwell();assert.deepEqual(geometryProblems(s,390),[]);
 s.line={top:810,bottom:873};assert.ok(geometryProblems(s,390).includes('the executing line is outside the viewport'));
});
test('a line inside the page but clipped by its own source window still fails',()=>{
 const s=dwell();s.line={top:700,bottom:763};assert.deepEqual(geometryProblems(s,390),['the executing line is clipped by its source window']);
});
test('sticky overlap, inaccessible controls and a collapsed diagram are failures',()=>{
 const s=dwell();s.dg.bottom=680;s.dg.height=680;s.bar.bottom=900;
 assert.ok(geometryProblems(s,390).includes('the executing line is under the sticky diagram'));
 assert.ok(geometryProblems(s,390).includes('Run/Step controls are outside the viewport'));
 s.dg.top=900;s.dg.bottom=1100;assert.ok(geometryProblems(s,390).includes('the diagram is outside the viewport'));
});

test('a single real mutation can change a picture; static or captionless examples fail',()=>{
 assert.equal(diagramChanges(3,1),true);
 assert.equal(diagramChanges(3,0),false);
 assert.equal(diagramChanges(2,4),false);
});
