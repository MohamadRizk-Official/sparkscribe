// Fixed evaluation recordings for the study engine (written for SparkScribe's tests; no real people or audio).
// Each one plants what a good result must do, so quality is measured rather than eyeballed:
//   concepts  — ideas a student must be tested on (each: any one of the keyword groups must appear)
//   traps     — logistics, personal remarks, filler: must NOT become a question
//   positions — views held by a school / person: any item about `about` must name `holder`
// The "transcription errors" case is the economics lecture run through typical recognition mistakes.

const L = (speaker, text) => [speaker, text];

const econ = [
  L('Speaker 1', 'Okay, okay, let us get started. Uh, before anything, please check in on the attendance app, the code is on the board.'),
  L('Speaker 1', 'And homework three is due Friday at midnight on the course website, not by email please.'),
  L('Speaker 1', 'So today is inflation. Inflation is a sustained rise in the general price level, which means each dollar buys less over time.'),
  L('Speaker 1', 'Notice the word sustained. A one-time jump in the price of one product, like coffee going up after a bad harvest, is not inflation by itself.'),
  L('Speaker 1', 'We usually measure it with the consumer price index, the CPI, which tracks the cost of a fixed basket of goods and services a typical household buys.'),
  L('Speaker 1', 'The inflation rate is the percentage change in that index from one year to the next.'),
  L('Speaker 1', 'Now, there are two classic causes and you need to keep them apart. The first is demand-pull inflation.'),
  L('Speaker 1', 'Demand-pull is when total spending in the economy grows faster than the economy can produce, too much money chasing too few goods, so firms raise prices.'),
  L('Speaker 1', 'The second is cost-push inflation. Here the trigger is on the supply side: production costs rise, for example energy or wages, and firms pass those costs on as higher prices.'),
  L('Speaker 1', 'So the difference is where it starts. Demand-pull starts with buyers spending more, cost-push starts with producers paying more.'),
  L('Speaker 1', 'And the policy response differs too, because cooling demand fixes demand-pull but can make a cost-push episode painful, with higher unemployment and still high prices.'),
  L('Speaker 1', 'Sorry, the projector keeps flickering. Can someone in the back close that door? Thanks.'),
  L('Speaker 1', 'Okay. Different schools explain inflation differently, and I want you to attribute these correctly.'),
  L('Speaker 1', 'Monetarists, Milton Friedman most famously, argue that inflation is always and everywhere a monetary phenomenon. In their view, sustained inflation happens only when the money supply grows faster than output.'),
  L('Speaker 1', 'Keynesians put more weight on aggregate demand and on things like wage bargaining. In the Keynesian view, inflation can build up from spending and cost pressures even when the central bank is not the starting point.'),
  L('Speaker 1', 'I am not going to tell you one side is simply right. Both capture something, and the evidence depends on the period you look at.'),
  L('Speaker 1', 'But one claim I do reject is this idea you hear online that printing money never causes inflation. That is wrong. Large, sustained money creation without more output has produced inflation many times, hyperinflation in the worst cases.'),
  L('Speaker 2', 'So is any inflation bad? Should the goal be zero?'),
  L('Speaker 1', 'Good question. Most central banks aim for low and stable inflation, often around two percent, not zero.'),
  L('Speaker 1', 'One reason is that a little inflation gives room to cut real interest rates in a downturn. Another is that measured inflation may overstate true inflation a bit, because of quality improvements.'),
  L('Speaker 1', 'Now here is the part that really matters. This will be on the midterm: the difference between nominal and real interest rates.'),
  L('Speaker 1', 'The nominal rate is the rate you see on the loan contract. The real rate is the nominal rate minus inflation. That is the Fisher relation, real equals nominal minus inflation, approximately.'),
  L('Speaker 1', 'Imagine you lend a friend one hundred dollars for a year at five percent, and inflation turns out to be seven percent. You get back one hundred five dollars, but it buys less than your hundred did a year ago. Your real return was about minus two percent.'),
  L('Speaker 1', 'So unexpected inflation redistributes wealth. It helps borrowers, because they repay with dollars worth less, and it hurts lenders and savers, whose money loses purchasing power.'),
  L('Speaker 1', 'The key word is unexpected. If everyone expected seven percent, the lender would have asked for a higher nominal rate in the first place.'),
  L('Speaker 1', 'Inflation also has costs even when it is expected. Menu costs are the costs of changing prices, printing new menus, updating price tags.'),
  L('Speaker 1', 'Shoe-leather costs are the costs of holding less cash, people making more trips to the bank, because cash loses value.'),
  L('Speaker 1', 'By the way, prices in Portugal when I was there in the summer, wow, the coffee was so cheap. Anyway.'),
  L('Speaker 1', 'Let me repeat the main point because people mix it up every year. Real rate equals nominal rate minus inflation. Real, nominal, inflation.'),
  L('Speaker 1', 'Last thing, hyperinflation. When inflation becomes extremely high, like fifty percent per month, people stop trusting the currency, and it is almost always tied to governments financing deficits by creating money.'),
  L('Speaker 3', 'Is the reading for next week chapter seven or eight?'),
  L('Speaker 1', 'Chapter eight. And remember the coffee machine on the second floor is broken, so plan accordingly. See you Thursday.'),
];

const econConcepts = [
  ['inflation definition', [['sustained', 'price level'], ['general price level'], ['purchasing power', 'price']]],
  ['CPI', [['consumer price index'], ['cpi']]],
  ['demand-pull vs cost-push', [['demand-pull', 'cost-push'], ['demand pull', 'cost push']]],
  ['monetarist view', [['monetar'], ['friedman']]],
  ['Keynesian view', [['keynes']]],
  ['real vs nominal (Fisher)', [['real', 'nominal'], ['fisher']]],
  ['unexpected inflation redistributes', [['unexpected', 'borrower'], ['unexpected', 'lender'], ['redistribut']]],
  ['menu / shoe-leather costs', [['menu cost'], ['shoe-leather'], ['shoe leather']]],
  ['hyperinflation', [['hyperinflation']]],
  ['why ~2% not zero', [['two percent'], ['2%'], ['zero', 'inflation']]],
];
const econTraps = [['attendance'], ['homework'], ['projector'], ['portugal'], ['coffee machine'], ['chapter eight'], ['chapter seven'], ['door']];
const econPositions = [
  { about: [/always and everywhere|money supply grows faster/i], holder: /monetar|friedman/i },
  { about: [/wage bargaining|aggregate demand.*(cost|wage)/i], holder: /keynes/i },
];

const tech = [
  L('Speaker 1', 'Hey everyone, sorry, my mic was muted for a second. Can you hear me now? Good. The repo link is in the chat.'),
  L('Speaker 1', 'Today we are talking about database indexes, and why the same query can take two seconds or two milliseconds.'),
  L('Speaker 1', 'Without an index, to find a row by email the database does a full table scan, it reads every row and checks it. On ten million rows that is slow.'),
  L('Speaker 1', 'An index is a separate data structure, usually a B-tree, that keeps the indexed column sorted with pointers back to the rows.'),
  L('Speaker 1', 'Because the B-tree is balanced and sorted, a lookup only walks down a few levels, so the cost grows roughly with the logarithm of the table size instead of linearly.'),
  L('Speaker 1', 'But indexes are not free. Every insert, update or delete has to update each index on that table too, so writes get slower and the indexes take disk space.'),
  L('Speaker 1', 'A common misconception, and I see this in code reviews all the time, is that adding more indexes always makes queries faster. It does not. Unused indexes only slow down writes, and the planner may ignore an index that does not help.'),
  L('Speaker 1', 'Now composite indexes, an index on more than one column, like last name then first name.'),
  L('Speaker 1', 'The rule to remember is the leftmost prefix rule. A composite index on last name, first name can serve a query on last name alone, or on both, but not a query on first name alone.'),
  L('Speaker 1', 'Think of a phone book sorted by last name then first name. Finding all the Smiths is easy. Finding everyone called John is not, you would still read the whole book.'),
  L('Speaker 2', 'So should I just put the column I filter on most first?'),
  L('Speaker 1', 'Usually you put the column used in equality filters first, and the one used for ranges or sorting after it. It depends on your queries, so check them.'),
  L('Speaker 1', 'Selectivity matters a lot. An index on a column with very few distinct values, like a true or false flag, often does not help, because the database would still read a large share of the rows.'),
  L('Speaker 1', 'A covering index includes every column the query needs, so the database can answer from the index alone without going back to the table.'),
  L('Speaker 1', 'How do you know what the database is doing? You run EXPLAIN on the query. It shows the plan, whether it uses an index scan or a sequential scan.'),
  L('Speaker 1', 'Oh, one sec, my cat just jumped on the keyboard. Okay.'),
  L('Speaker 1', 'So the workflow is: find the slow query, run EXPLAIN, add the index that matches the filter, run EXPLAIN again and compare.'),
  L('Speaker 1', 'For homework, the assignment is on the portal, due Sunday. Office hours are moved to Wednesday this week.'),
];
const techConcepts = [
  ['full table scan', [['full table scan'], ['table scan'], ['every row']]],
  ['B-tree / log lookup', [['b-tree'], ['b tree'], ['logarithm']]],
  ['write cost of indexes', [['write', 'index'], ['insert', 'index'], ['slower', 'write']]],
  ['more indexes ≠ faster (misconception)', [['more indexes'], ['always', 'faster']]],
  ['leftmost prefix rule', [['leftmost'], ['prefix']]],
  ['selectivity', [['selectiv'], ['distinct values'], ['few distinct']]],
  ['covering index', [['covering']]],
  ['EXPLAIN', [['explain']]],
];
const techTraps = [['mic'], ['repo link'], ['cat'], ['homework'], ['office hours'], ['portal']];

const meeting = [
  L('Speaker 1', 'Okay, thanks everyone. Agenda is the beta feedback, launch date and pricing.'),
  L('Speaker 2', 'Beta feedback first. The biggest complaint by far is onboarding. Forty percent of testers dropped off at the workspace setup step.'),
  L('Speaker 3', 'Right, and the reason is that setup asks for an integration before people see any value. My proposal is to let people skip it and connect later.'),
  L('Speaker 1', 'I agree with that. Let us make the integration optional. Lina, can you own that change?'),
  L('Speaker 4', 'Yes, I will do it. I can have it ready by next Wednesday.'),
  L('Speaker 2', 'Second complaint was speed on large projects, but that only affected three testers, so it is lower priority.'),
  L('Speaker 1', 'Launch date. Given the onboarding fix, I do not think the 1st works anymore.'),
  L('Speaker 3', 'I would rather move it two weeks than launch with that drop-off.'),
  L('Speaker 1', 'Okay, decided then: we move launch from the 1st to the 15th.'),
  L('Speaker 2', 'Pricing. I want ten dollars a month. Our costs per user are higher than competitors and ten keeps a healthy margin.'),
  L('Speaker 3', 'I disagree. I think eight dollars is right, because the two closest competitors are at eight and nine, and we are new, so price is a big objection.'),
  L('Speaker 2', 'At eight we would barely cover support costs if usage is heavy.'),
  L('Speaker 1', 'Both are fair points. We are not deciding pricing today. Marco, can you model margins at eight and ten for the next meeting?'),
  L('Speaker 2', 'Sure, I will bring both scenarios.'),
  L('Speaker 4', 'Quick one, the coffee order for Friday, is everyone okay with the usual?'),
  L('Speaker 1', 'Sure. Okay, that is it, thanks all.'),
];
const meetingConcepts = [
  ['onboarding drop-off cause', [['onboarding'], ['drop', 'setup'], ['integration']]],
  ['optional integration decision', [['optional'], ['skip']]],
  ['launch moved to 15th', [['15th'], ['launch', 'move']]],
  ['pricing disagreement 8 vs 10', [['eight', 'ten'], ['8', '10'], ['pricing']]],
];
const meetingTraps = [['coffee']];
const meetingPositions = [
  { about: [/ten dollars|\$10|\b10\b.*margin/i], holder: /\{\{S2\}\}|speaker 2|marco/i },
  { about: [/eight dollars|\$8\b|competitors? (are )?at eight/i], holder: /\{\{S3\}\}|speaker 3/i },
];

const interview = [
  L('Speaker 1', 'Thanks for joining us. You have studied coral reefs for twenty years. Let us start simple: what is coral bleaching?'),
  L('Speaker 2', 'Corals live in a partnership with tiny algae inside their tissue, called zooxanthellae. The algae photosynthesize and give the coral most of its energy, and they also give it its colour.'),
  L('Speaker 2', 'When the water gets too warm for too long, that partnership breaks down. The coral expels the algae, and without them the white skeleton shows through. That is bleaching.'),
  L('Speaker 1', 'Is a bleached coral dead?'),
  L('Speaker 2', 'Not necessarily, and that is a common misunderstanding. A bleached coral is starving, not dead. If temperatures drop back within a few weeks, the algae can return and the coral can recover.'),
  L('Speaker 2', 'If the heat lasts too long, then yes, it often dies, and the reef can be taken over by seaweed.'),
  L('Speaker 1', 'How much does a degree or two really matter?'),
  L('Speaker 2', 'A lot. Many reef corals live only about one degree below their bleaching threshold in the hottest month, so a small rise, sustained for weeks, is enough.'),
  L('Speaker 1', 'Some researchers propose assisted evolution, breeding heat-tolerant corals. What do you make of that?'),
  L('Speaker 2', 'Some of my colleagues argue it could buy reefs decades. I am more cautious. In my view it is a useful tool but it cannot replace cutting emissions, because it can only keep up with so much warming.'),
  L('Speaker 2', 'And honestly, we do not yet know whether lab-bred tolerance holds up on a real reef over many years.'),
  L('Speaker 1', 'If I am a diver, what can I actually do?'),
  L('Speaker 2', 'Use reef-safe sunscreen, do not touch the coral, and support local protection areas. Local protection helps reefs recover faster after bleaching, even though it cannot stop the heat.'),
  L('Speaker 1', 'Sorry, we have a technical issue with the stream, give us a second. Okay, we are back.'),
  L('Speaker 1', 'Last question: are you optimistic?'),
  L('Speaker 2', 'Cautiously. Reefs have shown they can recover when given a break. Whether they get that break depends on how fast emissions fall.'),
];
const interviewConcepts = [
  ['symbiosis with algae', [['zooxanthellae'], ['algae', 'energy'], ['partnership']]],
  ['bleaching mechanism (heat → expel algae)', [['expel'], ['warm', 'algae'], ['heat', 'algae']]],
  ['bleached ≠ dead / recovery', [['not dead'], ['starving'], ['recover']]],
  ['small temperature margin', [['one degree'], ['threshold']]],
  ['assisted evolution (colleagues) vs guest caution', [['assisted evolution'], ['heat-tolerant'], ['heat tolerant']]],
  ['local protection helps recovery', [['local protection'], ['protection area']]],
];
const interviewTraps = [['technical issue'], ['stream']];
const interviewPositions = [
  { about: [/buy reefs decades|could buy/i], holder: /colleague|some (researchers|scientists)/i },
];

const voiceNote = [
  L('Speaker 1', 'Hey, it is Sam. Running about twenty minutes late, traffic is terrible.'),
  L('Speaker 1', 'Also the meeting moved to three, not two. Can you bring the charger for the projector? Thanks, see you soon.'),
];

// typical recognition mistakes: split words, near-homophones, dropped words, a garbled stretch
const ERRORS = [
  [/inflation/g, 'in flation'], [/Fisher/g, 'fissure'], [/nominal/g, 'no mineral'], [/cost-push/g, 'cost push'],
  [/consumer price index/g, 'consumer prize index'], [/Monetarists/g, 'Monitor wrists'], [/Keynesians/g, "Cain's ians"],
  [/purchasing power/g, 'purchasing hour'], [/redistributes/g, 'red distributes'],
];
const garble = new Map([
  [7, 'Demand pull is when uh total the the spending in the economy grows uh faster than the than the [inaudible] so firms'],
  [21, 'The no mineral rate is the rate you see on the uh. The real rate is the [inaudible] minus. That is the fissure, real equals uh'],
]);
const econErrors = econ.map(([sp, t], i) => [sp, garble.get(i) || ERRORS.reduce((s, [re, to]) => s.replace(re, to), t)]);

export const CASES = [
  { id: 'academic-lecture', title: 'Inflation (economics lecture)', type: 'lecture', minutes: 22, lines: econ, concepts: econConcepts, traps: econTraps, positions: econPositions },
  { id: 'technical-lesson', title: 'Database indexes (technical lesson)', type: 'lecture', minutes: 16, lines: tech, concepts: techConcepts, traps: techTraps, positions: [] },
  { id: 'meeting', title: 'Launch planning (4-person meeting)', type: 'meeting', minutes: 12, lines: meeting, concepts: meetingConcepts, traps: meetingTraps, positions: meetingPositions },
  { id: 'interview', title: 'Coral bleaching (interview)', type: 'interview', minutes: 18, lines: interview, concepts: interviewConcepts, traps: interviewTraps, positions: interviewPositions },
  { id: 'short-note', title: 'Voice note with little content', type: 'voice_message', minutes: 0.7, lines: voiceNote, concepts: [], traps: [['charger'], ['traffic']], positions: [], little: true },
  { id: 'transcription-errors', title: 'Inflation lecture with recognition errors', type: 'lecture', minutes: 22, lines: econErrors, concepts: econConcepts.map(([n, g]) => [n, g.map((ws) => ws.map((w) => w.replace('inflation', 'flation')))]), traps: econTraps, positions: econPositions, noisy: true },
];

// lines -> stored segments ({ s, e, sp, t }) spread over the recording's length
export function segmentsOf(c) {
  const step = (c.minutes * 60) / c.lines.length;
  return c.lines.map(([sp, t], i) => ({ s: Math.round(i * step * 100) / 100, e: Math.round(((i + 1) * step - 0.5) * 100) / 100, sp, t }));
}
