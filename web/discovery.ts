// Public event metadata used for local, content-based recommendations.
const programs: Record<string, [string, string]> = {
  'Midnight Frequencies': ['electronic', 'electronic dance music DJ synth beats energetic late night'],
  'Blue Hour Sessions': ['jazz', 'live jazz saxophone piano improvisation relaxing mellow music'],
  'Ideas After Hours': ['talk', 'speaker ideas talks learning discussion inspiration keynote'],
  'The Acoustic Room': ['acoustic', 'quiet intimate unplugged guitar acoustic singer songwriter mellow music'],
  'Stand-Up Saturday': ['comedy', 'stand up comedy jokes funny laughter comedian laugh'],
  'Stories on Stage': ['theatre', 'storytelling literature theatre drama narrative performance spoken word'],
  'Indie Soundcheck': ['indie', 'indie rock band drums guitar live alternative music concert']
};
interface Listing {name:string;genre:string;venue:string}
export function photoFor(show: Listing) {
  const file = programs[show.name]?.[0] ?? ({ Jazz:'jazz', Electronic:'electronic' }[show.genre] || 'theatre');
  return 'url("/media/' + file + '.jpg")';
}
const stop = new Set('a an the i me my want would to for some with and of in at please like something'.split(' '));
function terms(text:string) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(word => !stop.has(word));
}
// Rank documents using TF-IDF cosine similarity over the current catalog.
export function recommend<T extends Listing>(shows:T[], query:string): T | undefined {
  const documents = shows.map(show => terms([show.name, show.genre, show.venue, programs[show.name]?.[1]].join(' ')));
  const frequency = new Map<string, number>();
  for(const document of documents) for(const word of new Set(document)) frequency.set(word,(frequency.get(word) ?? 0)+1);
  function vector(words:string[]) {
    const weights = new Map<string, number>();
    for(const word of words) {
      const count = frequency.get(word);
      if(count) weights.set(word,(weights.get(word) ?? 0)+1+Math.log((1+shows.length)/(1+count)));
    }
    return weights;
  }
  const norm = (weights:Map<string, number>) => Math.hypot(...weights.values());
  const preference = vector(terms(query));
  const queryNorm = norm(preference);
  if(!queryNorm) return;
  let highest = 0;
  let match:T | undefined;
  documents.forEach((document,index) => {
    const weights = vector(document);
    let product = 0;
    for(const [word,weight] of preference) product += weight*(weights.get(word) ?? 0);
    const score = product/(norm(weights)*queryNorm);
    if(score>highest){highest=score;match=shows[index];}
  });
  return match;
}

// Search every contiguous block. Prefer the chosen row zone, then the centre.
export function suggestSeats(rows:string[], columns:number[], occupied:ReadonlyMap<string,string>, size:number, zone:string): string[] {
  if(!Number.isInteger(size) || size<1 || size>columns.length) return [];
  const targetRow = zone==='Front' ? 0 : zone==='Back' ? rows.length-1 : (rows.length-1)/2;
  let best:string[]=[];
  let lowest=Infinity;
  rows.forEach((row,index)=>{
    for(let start=0;start<=columns.length-size;start++){
      const block=columns.slice(start,start+size);
      // The seat map inserts its centre aisle before this column.
      const aisle=1+Math.floor((columns.length+1)/2);
      if(block[0]<aisle && block[block.length-1]>=aisle)continue;
      const seats=block.map(col=>row+col);
      if(seats.some(seat=>occupied.has(seat)))continue;
      const score=Math.abs(index-targetRow)*(columns.length+1)+Math.abs(start+(size-1)/2-(columns.length-1)/2);
      if(score<lowest){best=seats;lowest=score;}
    }
  });
  return best;
}
