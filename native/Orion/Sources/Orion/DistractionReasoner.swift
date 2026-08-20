//
//  What actually does the thinking about which apps to close.
//
//  The local model, not the gateway, and for the reason already written down in
//  LocalModel.swift: an agent and a text transform are different jobs. Deciding
//  whether Music belongs to "write the deploy notes" needs no tools, no memory
//  of yesterday and no conversation — it needs a completion. Routing it through
//  `openclaw agent` would hand a decision about closing apps to something
//  holding Orion's entire toolset, and it measured forty times slower.
//
//  It also keeps the list of what is running on this machine on this machine.
//
//  If Ollama is not up, this throws, and the caller closes nothing and says why.
//  That is the intended failure: every path through this feature fails towards
//  leaving apps open.
//

import Foundation
import SessionService

final class LocalModelReasoner: DistractionReasoning {

    /// Short. A session is starting and the person is waiting to work; a model
    /// that has not answered in this long has effectively declined, and
    /// declining means nothing gets closed.
    private let timeout: TimeInterval

    init(timeout: TimeInterval = 60) {
        self.timeout = timeout
    }

    func answer(_ prompt: String) throws -> String {
        // Cold, because this is a judgement about somebody's open apps and the
        // same machine state should give the same answer twice.
        //
        // `requireSentenceEnding` off: that guard exists for the prose summaries
        // and is exactly wrong here, because well-formed JSON ends in "]" and
        // would be rejected as truncated every single time.
        //
        // A larger budget than the default because `gpt-oss:20b` spends the
        // first several hundred tokens thinking before it writes anything, and
        // this answer has a line per running app.
        try LocalModel.complete(prompt: prompt, maxTokens: 2400, temperature: 0.1,
                                timeout: timeout, requireSentenceEnding: false)
    }
}
