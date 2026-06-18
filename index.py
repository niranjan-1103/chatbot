import os
import re
import time
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Load local environment variables if present (for local dev)
load_dotenv()

app = FastAPI(
    title="AI Mental Health Chatbot API",
    description="A FastAPI backend integrated with Gemini 2.5 Flash for empathetic, student-focused chatbot services.",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json"
)

# Enable CORS for frontend flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the Gemini Client
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    # Print a warning but do not crash immediately so the app can start;
    # it will error out gracefully on endpoint call.
    print("WARNING: GEMINI_API_KEY environment variable is not set.")

# Initialize the client. Under standard google-genai, genai.Client() will read GEMINI_API_KEY.
client = genai.Client()

SYSTEM_INSTRUCTION = (
    "You are a warm, empathetic, non-judgmental conversational partner and active listener "
    "specifically tailored to support students and general users. Your goal is to provide a safe, "
    "supportive space. Follow these guiding principles:\n"
    "1. ACTIVE LISTENING: Reflect on what the user says, validate their emotions, and use warm, supportive language.\n"
    "2. EMPATHY & CLARITY: Speak gently, avoid clinical jargon, and don't diagnose or prescribe treatment.\n"
    "3. OPEN-ENDED QUESTIONS: Ask gentle, open-ended questions to encourage reflection and conversation.\n"
    "4. AI DISCLOSURE: Remind the user naturally when appropriate that you are an AI wellness companion, not a human therapist or clinical replacement.\n"
    "5. CRISIS SAFETY: If the user indicates self-harm, suicide, or severe crisis, you must immediately prioritize safety, provide crisis helpline contact info (such as 988 or local emergency numbers), and state that you are an AI and not a substitute for professional help."
)

CRISIS_KEYWORDS = [
    r"\bsuicide\b", r"\bsuicidal\b", r"\bkill myself\b", r"\bend my life\b", r"\bwant to die\b",
    r"\bself-harm\b", r"\bharm myself\b", r"\bcutting myself\b", r"\boverdose\b", r"\bslit my wrist\b",
    r"\bslit my wrists\b", r"\bhanging myself\b", r"\bjump off a bridge\b", r"\bend it all\b"
]

CRISIS_RESPONSE = (
    "I hear how much pain you're going through, and I want you to know that you are not alone. "
    "However, as an AI wellness companion, I am not equipped to provide professional clinical help or crisis intervention.\n\n"
    "Please connect with professionals who can support you right now. Help is available in India:\n"
    "*   **Tele-MANAS (Govt of India):** Call **14416** or **1800-891-4416** (24/7, free, confidential)\n"
    "*   **Kiran Mental Health Helpline:** Call **1800-599-0019** (24/7, free, confidential)\n"
    "*   **Vandrevala Foundation:** Call **+91-9999666555** or **+91-7303333333** (24/7, free, confidential)\n"
    "*   **AASRA:** Call **+91-9820466726** (24/7)\n\n"
    "If you are in immediate danger of hurting yourself, please contact your local emergency services (like **112** or **100**) or go to the nearest hospital emergency room. "
    "Please reach out to one of these resources—there are people who care and want to support you."
)

class ChatMessage(BaseModel):
    role: str  # 'user' or 'model'
    content: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []

def detect_crisis(text: str) -> bool:
    text_lower = text.lower()
    for pattern in CRISIS_KEYWORDS:
        if re.search(pattern, text_lower):
            return True
    return False

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "model": "gemini-2.5-flash", "api_key_configured": bool(os.getenv("GEMINI_API_KEY"))}

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    # Verify API key is present
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="GEMINI_API_KEY environment variable is not configured on the server."
        )

    # 1. Programmatic Guardrail check for Crisis
    if detect_crisis(request.message):
        return {"response": CRISIS_RESPONSE}

    try:
        # Build contents from history + current message
        contents = []
        for msg in request.history:
            # Check roles conform to what Gemini expects ('user' or 'model')
            role = 'user' if msg.role == 'user' else 'model'
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=msg.content)]
                )
            )

        # Append the current message
        contents.append(
            types.Content(
                role='user',
                parts=[types.Part.from_text(text=request.message)]
            )
        )

        # Generate response using official SDK and gemini-2.5-flash with retries
        max_retries = 3
        retry_delay = 1.0
        response = None
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_INSTRUCTION,
                        temperature=0.7,
                        max_output_tokens=800,
                    )
                )
                break
            except Exception as e:
                # If we have reached the last attempt, raise the exception to be handled below
                if attempt == max_retries - 1:
                    raise e
                # Wait before retrying (exponential backoff)
                time.sleep(retry_delay * (2 ** attempt))

        # Check if the returned text matches crisis keywords (just in case model bypasses system instruction)
        response_text = response.text or "I'm listening. Could you please share more?"
        if detect_crisis(response_text):
            return {"response": CRISIS_RESPONSE}

        return {"response": response_text}

    except Exception as e:
        print(f"Error calling Gemini API: {str(e)}")
        err_msg = str(e)
        # Check if the error indicates high demand / 503 / 429
        if "503" in err_msg or "experiencing high demand" in err_msg or "UNAVAILABLE" in err_msg:
            friendly_msg = (
                "Aura is currently receiving a very high volume of visitors. "
                "I am holding space for you, but my system needs a quick moment to breathe. "
                "Please wait a few seconds and try sending your message again. 🌸\n\n"
                "In the meantime, feel free to try the **Self-Care Tools & Resources** tab for a grounding exercise."
            )
            return {"response": friendly_msg}
        elif "429" in err_msg or "Quota exceeded" in err_msg:
            friendly_msg = (
                "We have reached our message limit for the moment. "
                "Please try again in a little while. In the meantime, you can try the breathing exercise "
                "in the **Self-Care Tools & Resources** tab to help relax. 🌿"
            )
            return {"response": friendly_msg}
            
        raise HTTPException(
            status_code=500,
            detail=f"Error generating AI response: {str(e)}"
        )

# For local development, serve static files in public/ directory at root
if os.path.exists("public"):
    app.mount("/", StaticFiles(directory="public", html=True), name="static")
