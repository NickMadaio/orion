import Foundation
import FoundationModels
import MobileCore

/*
 ORION with the Mac off (2026-09-29).

 Nick: "i should be able to talk to orion even when my computer is off ... the
 iPhone app should run a small local model and keep the local state it needs
 for conversations, reminders, captures, and other basic actions even without
 the Mac or internet."

 When the Mac is not answering, the conversation tab answers on the phone.

 Scenario runs (2026-09-29) settled the design: given write tools, Apple's
 on-device model added seven reminders nobody asked for, invented times,
 re-logged a burrito when asked to open Spotify and copied an example out of
 its own instructions. So ACTIONS never come from the model: "drank two
 bottles", "remind me to X at 18:30", "had a burrito for lunch" are recognised
 by plain rules and done exactly. The model only (a) estimates calories for a
 food, as structured output, and (b) answers questions with his schedule and
 tonight's numbers pasted into the prompt and no tools at all. Anything that
 needs the Mac gets a fixed, honest answer.
*/
@MainActor
struct OfflineContext {
    let schedule: (Bool) -> String          // tomorrow?
    let addReminder: (String, Date?) -> Void
    let log: (LinkLog) -> Void
    /// "What should I do now": past bedtime → sleep; otherwise next event and top to-do.
    let next: () -> String
    let tonight: () -> String
}

@available(iOS 26.0, *)
@MainActor
final class OfflineBrain {
    private let context: OfflineContext
    private var last: (String, String)?

    init(context: OfflineContext) { self.context = context }

    static var available: Bool { SystemLanguageModel.default.availability == .available }

    static var unavailableReason: String {
        switch SystemLanguageModel.default.availability {
        case .available: return ""
        case .unavailable(.appleIntelligenceNotEnabled): return "Turn on Apple Intelligence in Settings and I can answer here while your Mac is off."
        case .unavailable(.modelNotReady): return "The on-device model is still downloading. Try again in a bit, or wait for your Mac."
        default: return "This iPhone can't run the on-device model."
        }
    }

    func answer(_ text: String, now: Date = Date()) async -> String {
        let reply = await respond(text, now: now)
        last = (text, reply)
        return reply
    }

    private func respond(_ text: String, now: Date) async -> String {
        switch OfflineIntent.parse(text, now: now) {
        case .water(let bottles):
            context.log(.water(delta: bottles))
            return "Logged \(bottles) bottle\(bottles == 1 ? "" : "s") of water. It reaches your Mac's health log when the Mac is back."
        case let .reminder(title, due):
            context.addReminder(title, due)
            return "Added to Reminders: \(title)\(due.map { ", \(Self.clock($0))" } ?? "")."
        case let .food(what, meal):
            let estimate = await estimate(what)
            context.log(.meal(title: what, meal: meal, calories: estimate.calories, protein: estimate.protein,
                              carbohydrates: 0, fat: 0))
            return "Logged \(what) for \(meal.lowercased()): about \(estimate.calories) kcal, \(estimate.protein) g protein (an estimate — fix it in Health if it's off)."
        case .note(let text):
            context.log(.note(text: text, at: ISO8601DateFormatter().string(from: now)))
            return "Noted: \(text). It goes into ORION's memory as soon as your Mac is back."
        case .schedule(let tomorrow):
            return context.schedule(tomorrow)
        case .tonight:
            return context.tonight()
        case .next:
            return context.next()
        case .needsMac:
            return "That needs your Mac, and it isn't answering right now. Ask me again once it's back — I can do your schedule, reminders, water and food from here."
        case .question:
            return await ask(text, now: now)
        }
    }

    /// Questions: no tools, his real day pasted in.
    private func ask(_ text: String, now: Date) async -> String {
        let facts = """
        It is \(now.formatted(date: .complete, time: .shortened)).
        TODAY — \(context.schedule(false))
        TOMORROW — \(context.schedule(true))
        SLEEP — \(context.tonight())
        """
        let instructions = """
        You are ORION, Nick's assistant, answering on his iPhone because his Mac is off. You are his \
        external executive function: help him do what he planned, sleep on time, and adapt when the \
        day changes. Talk like someone who knows him — short and direct, no motivational filler.
        His priorities: classes first, then sleep, gym, deadlines and study, an hour of side project a \
        day, other things, then rest.
        Answer ONLY from the facts below. Quote class names and times exactly as written there; if \
        something is not in the facts, say you can't see it from the phone. Never invent times, \
        people or tasks. Never calculate a time or a duration — only repeat numbers written in the \
        facts. At most two short sentences.
        If he is up past his bedtime, say so plainly using the SLEEP line's numbers exactly. Classes \
        come first: don't recommend skipping one unless he is ill — suggest sleeping now and a nap \
        after class instead.

        FACTS
        \(facts)
        """
        let earlier = last.map { "(Earlier he said \"\($0.0)\" and you answered \"\($0.1)\")\n" } ?? ""
        let session = LanguageModelSession(instructions: instructions)
        return (try? await session.respond(to: earlier + text).content)
            ?? "I couldn't work that out on the phone. It'll go through properly once your Mac is back."
    }

    @Generable
    struct FoodEstimate {
        @Guide(description: "Typical calories for this food as one person's portion", .range(0...3000))
        var calories: Int
        @Guide(description: "Typical protein in grams", .range(0...300))
        var protein: Int
    }

    private func estimate(_ food: String) async -> (calories: Int, protein: Int) {
        if let known = FoodTable.lookup(food) { return known }
        let session = LanguageModelSession(instructions: "Estimate nutrition for one ordinary portion. Be realistic.")
        guard let value = try? await session.respond(to: "Food: \(food)", generating: FoodEstimate.self).content,
              value.calories >= 80 else { return (500, 20) }   // a meal, roughly; he can correct it in Health
        return (value.calories, value.protein)
    }

    static func clock(_ date: Date) -> String { let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: date) }
}

/// Plain rules for what the phone may DO offline. Anything unrecognised is a question.
enum OfflineIntent: Equatable {
    case water(Int)
    case reminder(String, Date?)
    case food(String, meal: String)
    case note(String)
    case schedule(tomorrow: Bool)
    case tonight
    case next
    case needsMac
    case question

    static func parse(_ raw: String, now: Date) -> OfflineIntent {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = text.lowercased()
        let numbers = ["a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "1": 1, "2": 2, "3": 3]

        // "remind me to X [at 6pm | at 18:30 | tomorrow]"
        if let match = lower.range(of: #"^(please )?remind me (to |about )"#, options: .regularExpression) {
            var rest = String(text[match.upperBound...])
            var due: Date?
            if let time = rest.range(of: #"\s+at\s+(\d{1,2})(:(\d{2}))?\s*(am|pm)?\s*$"#, options: [.regularExpression, .caseInsensitive]) {
                due = Self.time(String(rest[time]), now: now)
                rest = String(rest[..<time.lowerBound])
            }
            let title = rest.trimmingCharacters(in: CharacterSet(charactersIn: " .!"))
            return title.isEmpty ? .question : .reminder(title, due)
        }
        // "note that…", "remember that…", "idea: …", "jot down…" — kept for ORION's memory.
        if let m = lower.range(of: #"^(please )?(note( that)?|remember( that)?|idea:?|capture|jot( this)? down|write down)\s+"#, options: .regularExpression),
           !lower.hasPrefix("remember to") {
            let text = String(text[m.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: " .!:"))
            if !text.isEmpty { return .note(lower.hasPrefix("idea") ? "Idea: \(text)" : text) }
        }
        // "drank two bottles of water", "had a bottle of water", "finished my water"
        if lower.range(of: #"\b(drank|drunk|had|finished|downed)\b.*\b(water|bottles?)\b"#, options: .regularExpression) != nil,
           !lower.contains("?") {
            let words = lower.split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
            let count = words.compactMap { numbers[$0] }.first ?? 1
            return .water(min(3, max(1, count)))
        }
        // "had a burrito for lunch", "ate pasta", "just ate a chicken wrap"
        if let eat = lower.range(of: #"\b(ate|eaten|had)\s+(a |an |some |my )?"#, options: .regularExpression),
           !lower.contains("?"), !lower.contains("class"), !lower.contains("lecture") {
            var what = String(text[eat.upperBound...])
            var meal = "Snack"
            if let m = what.range(of: #"\s+(for|at)\s+(breakfast|lunch|dinner|a snack|snack)\s*$"#, options: [.regularExpression, .caseInsensitive]) {
                let word = what[m].lowercased()
                meal = word.contains("breakfast") ? "Breakfast" : word.contains("lunch") ? "Lunch" : word.contains("dinner") ? "Dinner" : "Snack"
                what = String(what[..<m.lowerBound])
            } else {
                let hour = Calendar.current.component(.hour, from: now)
                meal = hour >= 4 && hour < 11 ? "Breakfast" : hour < 15 && hour >= 11 ? "Lunch" : hour >= 17 && hour < 22 ? "Dinner" : "Snack"
            }
            what = what.trimmingCharacters(in: CharacterSet(charactersIn: " .!"))
            if !what.isEmpty, what.count <= 80 { return .food(what, meal: meal) }
        }
        // "What should I do / work on now", "what's next".
        if lower.range(of: #"\b(what should i (do|work on|be doing|focus on)|what now|what'?s next|what do i do now)\b"#,
                       options: .regularExpression) != nil {
            return .next
        }
        // Sleep, bedtime, alarm: tonight's real numbers, not the model's guess.
        if lower.range(of: #"\b(alarm|bedtime|bed time|to be up|wake me|wake up|go to (bed|sleep)|still up|how much sleep|should i sleep)\b"#,
                       options: .regularExpression) != nil {
            return .tonight
        }
        // "What's today/tomorrow look like", "anything before lunch tomorrow", "what classes": the day itself.
        if lower.range(of: #"\b(schedule|classes|class|lectures?|calendar|what do i have|what have i got|anything (on|before|after|at)|free (today|tomorrow)|look like|to ?do list|to-dos?|todos)\b"#,
                       options: .regularExpression) != nil, !lower.contains("should"), Self.isQuestion(lower) {
            return .schedule(tomorrow: lower.contains("tomorrow"))
        }
        // Things only the Mac can do.
        if lower.range(of: #"^(can you |could you |please )?(open|launch|quit|close|play|pause|email|e-mail|text|message|send|call|search|google|look up|turn (on|off))\b"#,
                       options: .regularExpression) != nil {
            return .needsMac
        }
        return .question
    }

    /// "had a good lecture today" is not a question about the schedule.
    static func isQuestion(_ lower: String) -> Bool {
        lower.contains("?") || lower.range(of: #"^(what|when|where|which|do i|have i|is there|are there|any|show|list|tell me|how's|hows)\b"#,
                                           options: .regularExpression) != nil
    }

    /// "at 6pm" / "at 18:30" / "at 7" → the next such time today, or tomorrow if passed.
    static func time(_ phrase: String, now: Date) -> Date? {
        let digits = phrase.lowercased()
        guard let m = digits.range(of: #"(\d{1,2})(:(\d{2}))?\s*(am|pm)?"#, options: .regularExpression) else { return nil }
        let token = String(digits[m])
        let parts = token.components(separatedBy: CharacterSet(charactersIn: ": apm")).filter { !$0.isEmpty }
        guard var hour = Int(parts.first ?? ""), hour < 24 else { return nil }
        let minute = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        if token.contains("pm"), hour < 12 { hour += 12 }
        if token.contains("am"), hour == 12 { hour = 0 }
        guard var date = Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: now) else { return nil }
        if date <= now { date = Calendar.current.date(byAdding: .day, value: 1, to: date) ?? date }
        return date
    }
}

/// Typical portions for common foods: steadier than the small model's guesses.
enum FoodTable {
    static let items: [(String, Int, Int)] = [
        ("burrito", 700, 35), ("wrap", 500, 30), ("pasta", 650, 22), ("pizza", 800, 32), ("sandwich", 450, 22),
        ("salad", 350, 12), ("protein shake", 200, 30), ("shake", 250, 20), ("eggs", 180, 12), ("oatmeal", 300, 10),
        ("porridge", 300, 10), ("rice bowl", 700, 35), ("burger", 650, 30), ("fries", 400, 5), ("chips", 250, 3),
        ("chicken breast", 280, 50), ("chicken", 450, 40), ("steak", 600, 50), ("sushi", 450, 20), ("noodles", 550, 15),
        ("ramen", 600, 20), ("cereal", 250, 8), ("yogurt", 150, 15), ("yoghurt", 150, 15), ("banana", 105, 1),
        ("apple", 95, 0), ("latte", 190, 10), ("coffee", 5, 0), ("smoothie", 300, 8), ("cookie", 200, 2),
        ("pancakes", 450, 10), ("bagel", 300, 11), ("toast", 150, 5), ("soup", 250, 10), ("curry", 700, 30),
        ("kebab", 700, 40), ("nuggets", 450, 25), ("tacos", 500, 25), ("meal deal", 700, 25), ("croissant", 270, 5),
        ("crisps", 150, 2), ("chocolate", 230, 3), ("fruit", 100, 1), ("toastie", 450, 20), ("poke", 600, 30),
    ]
    static func lookup(_ food: String) -> (Int, Int)? {
        let lower = food.lowercased()
        return items.first { lower.contains($0.0) }.map { ($0.1, $0.2) }
    }
}
