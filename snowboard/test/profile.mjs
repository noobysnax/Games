import { terrainH, centerX } from '../src/course.js';
// convexity along the centreline: where would a rider at speed v leave the snow unintentionally?
let out=[];
for (let d=0; d<640; d+=1){ const x=centerX(d); const h0=terrainH(centerX(d-1.5),d-1.5),h1=terrainH(x,d),h2=terrainH(centerX(d+1.5),d+1.5); const curv=(h0-2*h1+h2)/2.25; if(curv<-0.03) out.push(`${d}:${curv.toFixed(3)}`);} 
console.log('convex spots (d:curvature, liftoff speed = sqrt(1.9*12/|c|)):'); console.log(out.join(' '));
