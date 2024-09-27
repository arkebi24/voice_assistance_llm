import OpenAI from "openai";
import dotenv from "dotenv";
import { OpenAI as LangchainOpenAI } from "@langchain/openai";
import { Ollama } from "@langchain/community/llms/ollama";
import axios from "axios";
import { z } from "zod"; // Add zod for input validation
import { NextApiRequest, NextApiResponse } from "next";

dotenv.config();

// Move configuration to a separate file or use environment variables
const CONFIG = {
  PERPLEXITY_ENDPOINT: process.env.PERPLEXITY_ENDPOINT || "https://api.perplexity.ai/chat/completions",
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
};

const openai = new OpenAI();

interface ResponseData {
  data: string;
  contentType: string;
  model: string;
}

type VoiceType = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

const requestSchema = z.object({
  message: z.string(),
  model: z.string().default("gpt"),
});

async function createAudio(fullMessage: string, voice: VoiceType): Promise<string> {
  try {
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: fullMessage,
    });
    const buffer = Buffer.from(await mp3.arrayBuffer());
    return buffer.toString("base64");
  } catch (error) {
    console.error("Error creating audio:", error);
    throw new Error("Failed to create audio");
  }
}

async function getModelResponse(modelName: string, prompt: string): Promise<string> {
  switch (modelName) {
    case "gpt":
    case "gpt4":
      const llm = new LangchainOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: modelName === "gpt4" ? "gpt-4" : undefined,
      });
      return await llm.invoke(prompt);
    case "local mistral":
    case "local llama":
      const ollamaModel = modelName === "local mistral" ? "mistral" : "llama2";
      const ollama = new Ollama({
        baseUrl: CONFIG.OLLAMA_BASE_URL,
        model: ollamaModel,
      });
      return await ollama.invoke(prompt);
    case "mixture":
    case "mistral":
    case "perplexity":
    case "llama":
      const perplexityModel = {
        mixture: "mixtral-8x7b-instruct",
        mistral: "mistral-7b-instruct",
        perplexity: "pplx-70b-online",
        llama: "llama-2-70b-chat",
      }[modelName];
      const response = await axios.post(
        CONFIG.PERPLEXITY_ENDPOINT,
        {
          model: perplexityModel,
          messages: [
            { role: "system", content: "Be precise and concise." },
            { role: "user", content: prompt },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      return response.data.choices[0].message.content;
    default:
      throw new Error(`Unsupported model: ${modelName}`);
  }
}

export default async function POST(req: NextApiRequest, res: NextApiResponse) {
  try {
    const body = await req.body;
    const { message, model: modelName } = requestSchema.parse(body);
    console.log(message, modelName);
    

    const prompt = `Be precise and concise, never respond in more than 1-2 sentences! ${message.toLowerCase().split(' ').slice(1).join(' ')}`;
    
    const gptMessage = await getModelResponse(modelName, prompt);

    const introMessage = `${modelName.charAt(0).toUpperCase() + modelName.slice(1)} here, `;
    const voice: VoiceType = modelName.includes("local") ? "fable" : "echo";
    
    const fullMessage = introMessage + gptMessage;
    const base64Audio = await createAudio(fullMessage, voice);
    const Result: ResponseData = {
      data: base64Audio,
      contentType: "audio/mp3",
      model: modelName,
    };
    res.status(200).json(Result);
  } catch (error) {
    console.error("Error processing request:", error);
    throw new Error("Failed to process request");
  }
}