import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ---------- GEMINI SETUP ----------
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("ERROR: GEMINI_API_KEY is missing in .env file");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });


// ===================================================================
// STEP 1: MINI CHUNK ANALYSIS PROMPT  (fast lightweight summarization)
// ===================================================================
function buildChunkPrompt(chunk) {
  const block = chunk.map((c,i)=>`${i+1}. ${c}`).join("\n");

  return `
Analyze these YouTube comments and return STRICT JSON:

{
 "pos": number,
 "neg": number,
 "neu": number,
 "praise": ["string"],
 "pain": ["string"],
 "themes": ["string"]
}

Extract:
- estimated positive %
- estimated negative %
- estimated neutral %
- 5 short praise bullets
- 5 short pain bullets
- 5 short audience themes

COMMENTS:
${block}
`;
}


// ===================================================================
// STEP 2: FINAL PREMIUM PROMPT (YOUR EXACT RULES PRESERVED)
// ===================================================================
function buildPremiumPrompt(aggregate) {
  // Use your original prompt text exactly — just replacing commentBlock
  // with our aggregated summary rather than raw comments.
  return `
You are a YouTube audience intelligence engine.

Analyze the provided aggregated comment summaries and return valid JSON only.
Do not use markdown or backticks.

Output premium, insight-dense analysis with clear audience patterns and strategic value.

Required JSON fields:
- positivePercentage (number)
- negativePercentage (number)
- neutralPercentage (number)

- sentimentSummary_premium (5–7 sentences)
- topPraise_premium (6–10 items)
- topPainPoints_premium (6–10 items)

- strategicOpportunity (4–6 sentences)
- audienceDeepProfile (4–6 sentences)
- contentIdeas (3–6 short items)
- engagementPatterns (3–6 short items)

Guidelines:
- Focus on real audience behavior and intent.
- Be concise but deep.
- Prioritize clarity and usefulness over verbosity.
- Assume this is a paid, professional report.

Return a single, complete JSON object matching the schema exactly.


{
  "positivePercentage": number,
  "negativePercentage": number,
  "neutralPercentage": number,

  "sentimentSummary_premium": "string",
  "actionableInsight_premium": "string",

  "topPraise_premium": ["string"],
  "topPainPoints_premium": ["string"],

  "strategicOpportunity": "string",
  "audienceDeepProfile": "string",
  "contentIdeas": ["string"],
  "engagementPatterns": ["string"]
}

### COMMENTS:
${JSON.stringify(aggregate)}
`;
}


// ===================================================================
// UTIL: run a chunk
// ===================================================================
async function runChunk(chunk){
  const prompt = buildChunkPrompt(chunk);
  const result = await model.generateContent({
    contents:[{role:"user",parts:[{text:prompt}]}]
  });

  const raw = result.response.text();
  const clean = raw.replace(/```json/gi,"").replace(/```/g,"").trim();

  try{
    return JSON.parse(clean);
  }catch(e){
    console.error("Chunk parse error:", raw);
    return { pos:0, neg:0, neu:0, praise:[], pain:[], themes:[] };
  }
}


// ===================================================================
// UTIL: run final premium (your original logic, but fed aggregated data)
// ===================================================================
async function runFinalPremium(aggregate){
  const prompt = buildPremiumPrompt(aggregate);
  const result = await model.generateContent({
    contents:[{role:"user",parts:[{text:prompt}]}]
  });

  const raw = result.response.text();
  const clean = raw.replace(/```json/gi,"").replace(/```/g,"").trim();
  return JSON.parse(clean);
}


// ===================================================================
// ROUTE
// ===================================================================
app.post("/analyze", async(req,res)=>{
  try{
    const {comments=[]} = req.body;
    if(!comments.length){
      return res.status(400).json({success:false,error:"No comments"});
    }

    // Split into chunks of 100
    const chunks = [];
    for(let i=0;i<comments.length;i+=100){
      chunks.push(comments.slice(i,i+100));
    }

    // Parallel chunk processing
    const partials = await Promise.all(chunks.map(runChunk));

    // Aggregate
    const posAvg = partials.reduce((s,p)=>s+p.pos,0) / partials.length;
    const negAvg = partials.reduce((s,p)=>s+p.neg,0) / partials.length;
    const neuAvg = partials.reduce((s,p)=>s+p.neu,0) / partials.length;

    const praise = partials.flatMap(p=>p.praise||[]);
    const pain  = partials.flatMap(p=>p.pain||[]);
    const themes = partials.flatMap(p=>p.themes||[]);

    const aggregate = {posAvg, negAvg, neuAvg, praise, pain, themes};

    // Final premium reasoning (your original rules)
    const final = await runFinalPremium(aggregate);

    // Insert actual numbers
    final.positivePercentage = Math.round(posAvg);
    final.negativePercentage = Math.round(negAvg);
    final.neutralPercentage  = Math.round(neuAvg);

    return res.json({success:true, data:final});

  }catch(err){
    console.error("ANALYSIS ERROR:", err);
    return res.status(500).json({success:false,error:err.message});
  }
});


// ===================================================================
const PORT = 3000;
app.listen(PORT,"0.0.0.0",()=>{
  console.log(`Chunked premium backend running on http://localhost:${PORT}`);
});
