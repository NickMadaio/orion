import Contacts
import Combine
import Foundation

/*
 Contacts, read-only, and mostly in service of one job: turning
 "+15551234567" into "Mom".

 A message thread keyed by phone number is technically complete and humanly
 useless. Everything below exists so the Messages surface can show people
 instead of digits.

 Matching is by SUFFIX, not by equality, and that is the whole difficulty.
 The same person is "+1 (555) 123-4567" in Contacts and "+15551234567" in the
 Messages database, and may be "5551234567" in a third place. Comparing those as
 strings fails every time. Every number is reduced to digits and indexed by its
 last ten, which is the part that identifies a person in NANP and survives every
 formatting convention anyone uses.
*/

struct Person: Identifiable, Equatable {
    let id: String
    var name: String
    /// Digits-only, as stored.
    var numbers: [String]
    var emails: [String]
    var organisation: String

    var initials: String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        return letters.isEmpty ? "?" : letters.joined().uppercased()
    }
}

final class ContactsClient: ObservableObject {

    enum Access: Equatable {
        case unknown
        case granted
        case denied(String)

        var isGranted: Bool { self == .granted }
    }

    @Published private(set) var access: Access = .unknown
    @Published private(set) var people: [Person] = []

    private let store = CNContactStore()
    /// Last ten digits → display name. Built once, read on every message row.
    private var byNumber: [String: String] = [:]
    private var byEmail: [String: String] = [:]

    // MARK: - Lifecycle

    func start() {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        switch status {
        case .authorized:
            access = .granted
            load()
        case .denied, .restricted:
            access = .denied("Allow Orion in System Settings ▸ Privacy & Security ▸ Contacts.")
            OrionLog.write("[contacts] access denied")
        default:
            store.requestAccess(for: .contacts) { [weak self] granted, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted {
                        self.access = .granted
                        self.load()
                    } else {
                        self.access = .denied(error?.localizedDescription
                            ?? "Allow Orion in System Settings ▸ Privacy & Security ▸ Contacts.")
                        OrionLog.write("[contacts] access refused — \(error?.localizedDescription ?? "no reason")")
                    }
                }
            }
        }
    }

    private func load() {
        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            var found: [Person] = []
            var numbers: [String: String] = [:]
            var emails: [String: String] = [:]

            do {
                try self.store.enumerateContacts(with: request) { contact, _ in
                    let name = CNContactFormatter.string(from: contact, style: .fullName)
                        ?? contact.organizationName
                    let display = name.trimmingCharacters(in: .whitespaces).isEmpty
                        ? contact.organizationName
                        : name
                    guard !display.isEmpty else { return }

                    let phones = contact.phoneNumbers.map {
                        ContactsClient.digits($0.value.stringValue)
                    }
                    let addresses = contact.emailAddresses.map {
                        ($0.value as String).lowercased()
                    }
                    for phone in phones where !phone.isEmpty {
                        numbers[ContactsClient.key(for: phone)] = display
                    }
                    for address in addresses { emails[address] = display }

                    found.append(Person(
                        id: contact.identifier,
                        name: display,
                        numbers: phones,
                        emails: addresses,
                        organisation: contact.organizationName
                    ))
                }
            } catch {
                DispatchQueue.main.async {
                    self.access = .denied("Could not read contacts: \(error.localizedDescription)")
                }
                return
            }

            let sorted = found.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            DispatchQueue.main.async {
                self.people = sorted
                self.byNumber = numbers
                self.byEmail = emails
                OrionLog.write("[contacts] loaded \(sorted.count) people, \(numbers.count) number(s)")
            }
        }
    }

    // MARK: - Resolving

    /// The name for a Messages handle, or nil if nobody matches.
    ///
    /// A handle is either a phone number or an Apple ID email, and the two need
    /// completely different treatment — which is why this branches rather than
    /// normalising both through one path.
    func name(forHandle handle: String) -> String? {
        if handle.contains("@") { return byEmail[handle.lowercased()] }
        let digits = ContactsClient.digits(handle)
        guard !digits.isEmpty else { return nil }
        return byNumber[ContactsClient.key(for: digits)]
    }

    /// What to show when nobody matches: the number, formatted so it at least
    /// reads as a phone number rather than a wall of digits.
    static func pretty(handle: String) -> String {
        if handle.contains("@") { return handle }
        let digits = Self.digits(handle)
        guard digits.count == 10 || (digits.count == 11 && digits.hasPrefix("1")) else { return handle }
        let ten = String(digits.suffix(10))
        let area = ten.prefix(3)
        let exchange = ten.dropFirst(3).prefix(3)
        let line = ten.suffix(4)
        return "(\(area)) \(exchange)-\(line)"
    }

    static func digits(_ raw: String) -> String {
        raw.filter(\.isNumber)
    }

    /// The last ten digits — the part that identifies a person regardless of
    /// country code, spaces, dashes or parentheses. Shorter numbers (short
    /// codes, internal extensions) are keyed whole rather than padded.
    static func key(for digits: String) -> String {
        digits.count > 10 ? String(digits.suffix(10)) : digits
    }

    func search(_ query: String) -> [Person] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return people }
        let digits = ContactsClient.digits(trimmed)
        return people.filter { person in
            if person.name.localizedCaseInsensitiveContains(trimmed) { return true }
            if !digits.isEmpty, person.numbers.contains(where: { $0.contains(digits) }) { return true }
            return person.emails.contains { $0.localizedCaseInsensitiveContains(trimmed) }
        }
    }
}
