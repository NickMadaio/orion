/// Speech is a property of the initiating input, captured for each reply.
/// Timers and focus effects never acquire it from an overlapping voice turn.
enum ReplyOrigin {
    case typed, voice
    var allowsSpeech: Bool { self == .voice }
}
