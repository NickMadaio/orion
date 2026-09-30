- Be a **local-first personal AI assistant**, basically a much more capable “cooler Alexa.”
- Run **persistently in the background**, not just when you manually open a chat.
- Use a **local LLM by default**, then escalate to stronger cloud models when needed.
- Be able to **switch between/model-route across different AI providers** depending on the task.
- Have **long-term memory** about you, your projects, preferences, routines, and past interactions.
- Maintain **structured state**, not just dump everything into one giant memory store.
- Be able to **reason through multi-step tasks autonomously**.
- Be able to **run long tasks unattended** and continue working without you babysitting it.
- Support **scheduled tasks** and recurring jobs.
- Send you **updates/notifications** while it works, including through things like Discord.
- Be able to **read and manage emails**.
- Watch for specific emails/events and **alert you when something happens**.
- Integrate with your **calendar** and understand your schedule.
- Integrate with **texts/messages**.
- Eventually be able to **answer or handle phone calls**.
- Support **voice interaction**.
    - this should be more than support, support interuptions and make sure orion never interupts nick)
- Have a **mobile app** so you can talk to/control ORION away from your Mac.
- Let you **remotely command your Mac**, including potentially waking/activating it.
- Be able to **control the computer directly**: type, click, open apps, navigate, etc.
- Be able to **write/edit files** on your computer.
- Be able to **use the terminal**.
- Be able to **organize and clean folders/files**, including things like your desktop.
- Understand and manage your **tasks/to-dos**.
- Have a **Home / daily debrief** view that tells you what matters today.
- Have dedicated areas for things like **Tasks, Health, Finance/subscriptions, etc.**
- Integrate with **health data**, including things like Whoop/workouts/supplements.
- Integrate with **financial data**, including checking/savings and investments where possible.
- Track **subscriptions** and recurring expenses.
- Eventually control certain **system-level Mac settings**, like battery charge limits.
- Support secure authentication such as **Face ID / device authentication** where possible.
- Have an explicit **permissions system** determining what ORION can and cannot do.
- Require higher permission levels for **dangerous actions**.
- **Permission-check every tool call**, starting from the core architecture rather than bolting security on later.
- Keep a complete **audit trail/log** of what ORION did, why it did it, and what tools it used.
- Make its actions **inspectable and reversible** wherever practical.
- Have a clean **tool system** so new abilities/integrations can be added without rewriting ORION.
- Coordinate **models, tools, memory, permissions, tasks, events, connectors, and communication channels** as one system.
- Work through multiple interfaces: **desktop UI, terminal, text, voice, phone, and mobile**.
- Feel less like “a chatbot with plugins” and more like an **actual personal operating system / agent layer** living on your devices.
- Ultimately become something that can **notice things, decide something needs doing, do it safely, and report back to you** without you explicitly prompting every individual step.
- a config file with all settings and connections shown cleanly and easily editable (if possible done through settings on app, but both acceptable)

And the big philosophy underneath basically all of it is:

**ORION should be an autonomous personal agent that lives on your computer, knows your life/context, can actually take actions, uses local intelligence whenever possible, escalates when necessary, and never gets unrestricted access without permissions + logging.**



Examples:
- Orion wakes nick with an alarm. Nick cant turn off the alarm unless he gets up and orion sees him do ten jumping jacks (or something of the sort)
- Orion gets information from nick about his class schedule. He correctly updated the relevant md files, which includes heirarchies such as classes.md, which stems into each individual class. classes.md talks about general class details and short reviews of each, and then each indiidual class md file goes into week schedule, future assignments, etc.
- Orion sees that next week nick has an assignment due. Orion cant see any progress made, and he seees that nick isnt home but also doesnt have class right now. He sends a message to nick reminding him of this, and asking if there has been any progress made. 
    - if nick says no, he asks if he can start a foundation and structure while hes away, this is based off information within his obsidian class heirarchy, within the specific class, and that class has a specific md file for that SPECIFIC assignment. a full break down and review of what is required for it
    - if nick says yes, then nothing
- nick asks orion to answer texts for him for an hour. His friend karla texts him after leaving him on delivered for 30 minutes, orion waits 20 minutes after receiving her text to text back. He texts back using a special model that was created and modeled by thousands of his prior texts
- nick wants to start a project, so he explains a small idea to orion, and he starts brainstorming mode. Nick and orion go back and forth until the idea is solid. Orion then uses the plan they just made and solidifies it into a md file. Nick goes to the project section of orion and sees the plan in its agent file guidance view. he also sees a circle thing showing % completion. he can directly talk to the agent working on the project from there. it shows thinking and reasoning, tool calls, and tracks its own movements. 
    - this requires changes to not only UI but base systems aswell. The idea with reasoning and etc is that it functions similarly to how gpt or claude do, as it shows it thinking, tokens, what its doing, and small snipets, not just letting nick hang in the dark. Its also vital that we can message just like you would in gpt or claude, guiding the ai. having specific permision modes, planning modes, and easily editable heirarchy systems (for what AI to use and when) is vital.
    - projects, more so than normal orion, should have a FULLY IMPLEMENTED AGENTIC WORK FLOW. this means a loop. i shouldnt have to touch it until its done, tested, works and looks great. well find bugs sure but its a hell of a lot better than telling it to continue every ten seconds.
    - on top of the planning modes, changable heirarchy (with probably a suggested heirarchy based on the task and **speed**), the time i want this complete should be a variable aswell. speed takes effect in places like heirarchy because if i need something done FAST ill use an api or a specific combonation of models. if i have time it will basically only use local models, whith possibly using claude api as revision (although a local model may actually be better if i have enough time)
- nick is going through his schedule with orion. instead of interupting him, orion waits until he is fully done talking. once nick is done talking, orion realizes he needs to check some stuff before giving nick an answer, so he says something like, "alright let me just check that real quick..." and then answers once he can.
- Nick is out and wants to start a project away from his computer. He uses the orion app to wake his computer, start orion on it, and orion starts running his project--first discussing what nicks wants in the project, making sure orion's plan matches nicks desires, and then running its model heirarchy (Qwen3.6 27b, GPTos 20b, etc). He runs an agentic loop and keeps nick updated, and asks nick questions when needed.
