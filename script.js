document.addEventListener('DOMContentLoaded', () => {
    // State management
    let chatHistory = [];
    let isListening = false;
    let speakResponseNext = false;
    let recognition = null;
    let breathingInterval = null;
    let isBreathingActive = false;

    // Elements
    const chatLog = document.getElementById('chatLog');
    const chatLogContainer = document.getElementById('chatLogContainer');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const micBtn = document.getElementById('micBtn');
    const statusText = document.getElementById('statusText');
    const pulseDots = document.getElementById('pulseDots');
    
    // Tab switching elements
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const mobileNavOverlay = document.getElementById('mobileNavOverlay');
    const closeMenuBtn = document.getElementById('closeMenuBtn');
    const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

    // Theme toggle elements
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    const mobileThemeToggleBtn = document.getElementById('mobileThemeToggleBtn');

    // Breathing elements
    const breathingCircle = document.getElementById('breathingCircle');
    const breathingText = document.getElementById('breathingText');
    const startBreathingBtn = document.getElementById('startBreathingBtn');

    // --- TAB SWITCHING LOGIC ---
    function switchTab(tabId) {
        // Update desktop nav
        navButtons.forEach(btn => {
            if (btn.getAttribute('data-tab') === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update mobile nav links
        mobileNavLinks.forEach(link => {
            if (link.getAttribute('data-tab') === tabId) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Toggle panel visibility
        tabPanels.forEach(panel => {
            if (panel.id === `${tabId}-tab`) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });

        // Close mobile menu if open
        closeMobileMenu();

        // Scroll chat to bottom if switching to chat
        if (tabId === 'chat') {
            scrollToBottom();
            chatInput.focus();
        }
    }

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.getAttribute('data-tab'));
        });
    });

    mobileNavLinks.forEach(link => {
        link.addEventListener('click', () => {
            switchTab(link.getAttribute('data-tab'));
        });
    });

    // Mobile Menu Toggle
    function openMobileMenu() {
        mobileNavOverlay.classList.add('active');
    }

    function closeMobileMenu() {
        mobileNavOverlay.classList.remove('active');
    }

    mobileMenuToggle.addEventListener('click', openMobileMenu);
    closeMenuBtn.addEventListener('click', closeMobileMenu);
    
    // Close mobile menu on overlay background click
    mobileNavOverlay.addEventListener('click', (e) => {
        if (e.target === mobileNavOverlay) {
            closeMobileMenu();
        }
    });

    // --- THEME MANAGEMENT LOGIC ---
    function setTheme(theme) {
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            updateThemeButtons('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark-theme');
            updateThemeButtons('light');
            localStorage.setItem('theme', 'light');
        }
    }

    function updateThemeButtons(theme) {
        const icon = theme === 'dark' ? '☀️' : '🌙';
        const text = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
        
        [themeToggleBtn, mobileThemeToggleBtn].forEach(btn => {
            if (btn) {
                const iconSpan = btn.querySelector('.theme-icon');
                const textSpan = btn.querySelector('.theme-text');
                if (iconSpan) iconSpan.textContent = icon;
                if (textSpan) textSpan.textContent = text;
            }
        });
    }

    function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            setTheme(savedTheme);
        } else {
            // Check system preference
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            setTheme(prefersDark ? 'dark' : 'light');
        }
    }

    // Theme Toggle Click Handlers
    [themeToggleBtn, mobileThemeToggleBtn].forEach(btn => {
        if (btn) {
            btn.addEventListener('click', () => {
                const isDark = document.body.classList.contains('dark-theme');
                setTheme(isDark ? 'light' : 'dark');
            });
        }
    });

    // Initialize theme
    initTheme();

    // --- MARKDOWN PARSER (Safe implementation) ---
    function formatMarkdown(text) {
        // Escape HTML to prevent XSS
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Convert headers (###, ##, #)
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Bold (**text**)
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Bullet lists
        html = html.replace(/^\s*[\*\-]\s+(.*)$/gim, '<li>$1</li>');

        // Links [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // Group consecutive <li> items into <ul>
        const lines = html.split('\n');
        let inList = false;
        let processedLines = [];

        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('<li>')) {
                if (!inList) {
                    processedLines.push('<ul>');
                    inList = true;
                }
                processedLines.push(line);
            } else {
                if (inList) {
                    processedLines.push('</ul>');
                    inList = false;
                }
                if (line.length > 0 && !line.startsWith('<h') && !line.startsWith('<ul') && !line.startsWith('<li')) {
                    processedLines.push(`<p>${line}</p>`);
                } else if (line.length > 0) {
                    processedLines.push(line);
                }
            }
        }
        if (inList) {
            processedLines.push('</ul>');
        }

        return processedLines.join('\n');
    }

    // --- CHAT LOGIC ---
    function scrollToBottom() {
        chatLogContainer.scrollTop = chatLogContainer.scrollHeight;
    }

    function appendMessage(role, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', role);

        const avatar = document.createElement('div');
        avatar.classList.add('avatar');
        avatar.textContent = role === 'user' ? '👤' : '🤖';

        const bubble = document.createElement('div');
        bubble.classList.add('message-bubble');
        bubble.innerHTML = formatMarkdown(text);

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(bubble);
        chatLog.appendChild(messageDiv);
        
        scrollToBottom();

        // Save to active session history (limit memory size)
        chatHistory.push({ role, content: text });
        if (chatHistory.length > 20) {
            chatHistory.shift();
        }
    }

    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text) return;

        // Reset chat input immediately
        chatInput.value = '';
        appendMessage('user', text);

        // Update processing state
        statusText.textContent = "Aura is typing...";
        pulseDots.style.display = 'flex';
        sendBtn.disabled = true;
        chatInput.disabled = true;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory.slice(0, -1) // Exclude current message since backend takes current message separately
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.detail || "Server error occurred");
            }

            const data = await response.json();
            const aiResponseText = data.response;

            appendMessage('model', aiResponseText);

            // Read AI response out loud if user used Voice Input
            if (speakResponseNext) {
                speakText(aiResponseText);
                speakResponseNext = false; // Reset state
            }

        } catch (error) {
            console.error("Chat error:", error);
            appendMessage('model', `I'm sorry, I encountered an issue connecting to my network: ${error.message}. Please verify the backend service is running and API key is set.`);
        } finally {
            statusText.textContent = "Ready to listen or chat";
            pulseDots.style.display = 'none';
            sendBtn.disabled = false;
            chatInput.disabled = false;
            chatInput.focus();
        }
    }

    // Trigger send on click or Enter key press
    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // --- SPEECH INPUT (Speech-to-Text) ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isListening = true;
            micBtn.classList.add('listening');
            micBtn.querySelector('.icon-mic').style.display = 'none';
            micBtn.querySelector('.icon-mic-off').style.display = 'block';
            statusText.textContent = "Listening closely... speak now";
            
            // Stop any ongoing Text-to-Speech synthesis
            window.speechSynthesis.cancel();
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            chatInput.value = transcript;
            statusText.textContent = "Speech transcribed.";
            speakResponseNext = true; // Read response out loud
            
            // Auto-send voice input for hands-free flow
            setTimeout(() => {
                sendMessage();
            }, 500);
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            statusText.textContent = `Speech error: ${event.error}. Try typing.`;
            speakResponseNext = false;
            stopListening();
        };

        recognition.onend = () => {
            stopListening();
        };

        function startListening() {
            try {
                recognition.start();
            } catch (err) {
                console.error("Failed to start speech recognition:", err);
            }
        }

        function stopListening() {
            isListening = false;
            micBtn.classList.remove('listening');
            micBtn.querySelector('.icon-mic').style.display = 'block';
            micBtn.querySelector('.icon-mic-off').style.display = 'none';
            if (statusText.textContent.startsWith("Listening")) {
                statusText.textContent = "Ready to listen or chat";
            }
            try {
                recognition.stop();
            } catch (err) {}
        }

        micBtn.addEventListener('click', () => {
            if (isListening) {
                stopListening();
            } else {
                startListening();
            }
        });
    } else {
        // Speech recognition not supported in browser
        micBtn.style.opacity = '0.5';
        micBtn.title = "Speech input is not supported in this browser (Use Chrome or Safari)";
        micBtn.addEventListener('click', () => {
            alert("Speech-to-Text is not supported by your current browser. We recommend Google Chrome or Apple Safari.");
        });
    }

    // --- SPEECH OUTPUT (Text-to-Speech) ---
    function speakText(text) {
        if (!window.speechSynthesis) return;

        // Cancel existing speeches
        window.speechSynthesis.cancel();

        // Strip HTML tags for cleaner speech rendering
        const plainText = text.replace(/<\/?[^>]+(>|$)/g, "");

        const utterance = new SpeechSynthesisUtterance(plainText);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;

        // Attempt to find a warm, female or pleasant English voice
        const voices = window.speechSynthesis.getVoices();
        let selectedVoice = voices.find(voice => 
            voice.lang.includes('en') && 
            (voice.name.includes('Google') || voice.name.includes('Natural') || voice.name.includes('Zira') || voice.name.includes('Samantha'))
        );

        if (!selectedVoice && voices.length > 0) {
            // Fallback to first English voice
            selectedVoice = voices.find(voice => voice.lang.includes('en'));
        }

        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }

        window.speechSynthesis.speak(utterance);
    }

    // Pre-load voices for Chrome/Safari compatibility
    if (window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {};
    }

    // --- BREATHING EXERCISE TIMER ---
    function stopBreathingExercise() {
        clearInterval(breathingInterval);
        isBreathingActive = false;
        startBreathingBtn.textContent = "Start Exercise";
        startBreathingBtn.classList.remove('active');
        breathingCircle.className = 'breathing-circle'; // Reset classes
        breathingText.textContent = "Ready...";
    }

    function startBreathingExercise() {
        isBreathingActive = true;
        startBreathingBtn.textContent = "Stop Exercise";
        
        let phase = 0; // 0: Inhale, 1: Hold, 2: Exhale, 3: Hold
        
        function runPhase() {
            if (!isBreathingActive) return;
            
            if (phase === 0) {
                breathingText.textContent = "Inhale slowly...";
                breathingCircle.className = 'breathing-circle inhale';
            } else if (phase === 1) {
                breathingText.textContent = "Hold your breath...";
                breathingCircle.className = 'breathing-circle hold';
            } else if (phase === 2) {
                breathingText.textContent = "Exhale slowly...";
                breathingCircle.className = 'breathing-circle exhale';
            } else if (phase === 3) {
                breathingText.textContent = "Hold...";
                breathingCircle.className = 'breathing-circle'; // Returns to scale(1)
            }
            
            phase = (phase + 1) % 4;
        }

        runPhase();
        breathingInterval = setInterval(runPhase, 4000); // Transitions every 4 seconds
    }

    startBreathingBtn.addEventListener('click', () => {
        if (isBreathingActive) {
            stopBreathingExercise();
        } else {
            startBreathingExercise();
        }
    });
});
