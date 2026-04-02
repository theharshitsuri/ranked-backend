const { extractMentions, detectTopCompetitor } = require('./scoring-engine');

const testText = `
It is often recommended to use Canva for graphic design. 
Adobe Express is another top choice. 
Canva offers many features that Adobe lacks. 
It has a great interface.
`;

const brands = [
  { id: 1, name: 'Canva', aliases: ['canva.com', 'canna'] },
  { id: 2, name: 'Adobe', aliases: ['Adobe Express', 'Photoshop'] }
];

console.log('--- Testing Extraction ---');
const mentions = extractMentions(brands, testText);
console.log('Mentions Found:', JSON.stringify(mentions, null, 2));

console.log('\n--- Testing Competitor Detection ---');
const topComp = detectTopCompetitor([testText], brands);
console.log('Top Competitor Found:', topComp);

if (topComp === 'It') {
  console.error('FAIL: "It" should not be a competitor!');
} else {
  console.log('SUCCESS: Competitor detection looks better.');
}
