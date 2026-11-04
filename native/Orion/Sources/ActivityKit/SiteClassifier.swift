import Foundation

/// A page's domain and what kind of site it is. Matching is by whole-label suffix, so "notyoutube.com" is not YouTube.
public enum SiteClassifier {
    /// "https://www.youtube.com/watch?v=1" -> "youtube.com". Nil for anything without a host.
    public static func domain(fromURL url: String) -> String? {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let host = URLComponents(string: trimmed)?.host?.lowercased(), host.contains(".") else { return nil }
        var h = host
        for prefix in ["www.", "m."] where h.hasPrefix(prefix) { h.removeFirst(prefix.count) }
        return h
    }

    static let video = ["youtube.com", "youtu.be", "netflix.com", "twitch.tv", "disneyplus.com", "hulu.com", "primevideo.com", "vimeo.com",
                        "crunchyroll.com", "max.com", "kick.com"]
    static let social = ["instagram.com", "x.com", "twitter.com", "reddit.com", "facebook.com", "tiktok.com", "snapchat.com", "bsky.app", "threads.net", "tumblr.com"]
    static let work = ["docs.google.com", "drive.google.com", "sheets.google.com", "slides.google.com", "mail.google.com", "github.com", "gitlab.com",
                       "notion.so", "figma.com", "overleaf.com", "linkedin.com", "slack.com", "atlassian.net", "canva.com", "stackoverflow.com",
                       "claude.ai", "chatgpt.com", "outlook.office.com", "office.com", "calendar.google.com", "indeed.com"]
    static let study = ["wikipedia.org", "khanacademy.org", "coursera.org", "quizlet.com", "instructure.com", "scholar.google.com", "brightspace.com",
                        "blackboard.com", "edx.org", "jstor.org", "arxiv.org", "leetcode.com", "w3schools.com"]
    static let shopping = ["amazon.com", "amazon.co.uk", "ebay.com", "ebay.co.uk", "etsy.com", "asos.com", "depop.com", "vinted.co.uk", "argos.co.uk", "zara.com"]
    static let news = ["bbc.co.uk", "bbc.com", "nytimes.com", "theguardian.com", "cnn.com", "news.ycombinator.com", "reuters.com", "apnews.com", "bloomberg.com", "ft.com"]

    public static func category(domain: String?) -> SiteCategory? {
        guard let d = domain?.lowercased(), !d.isEmpty else { return nil }
        let tables: [([String], SiteCategory)] = [(video, .video), (social, .social), (work, .work), (study, .study), (shopping, .shopping), (news, .news)]
        for (list, cat) in tables where list.contains(where: { matches(d, $0) }) { return cat }
        if d.hasSuffix(".edu") || d.hasSuffix(".ac.uk") || d.contains(".edu.") { return .study }
        return .other
    }

    private static func matches(_ domain: String, _ entry: String) -> Bool {
        let host = entry.split(separator: "/").first.map(String.init) ?? entry
        return domain == host || domain.hasSuffix("." + host)
    }
}
