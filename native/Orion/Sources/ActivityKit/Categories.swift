import Foundation

/// The `category` of the app in front (ACTIVITY CONTRACT, .builds/w19/COMMON.md).
public enum ActivityCategory: String, Codable, Equatable {
    case browser, game, work, study, chat, media, social, system, other
}

/// The `siteCategory` of the page in a browser.
public enum SiteCategory: String, Codable, Equatable {
    case video, social, work, study, shopping, news, other
}
