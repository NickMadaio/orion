import Foundation

/// The keyboard state of the list: which row is selected, Tab between sections, ⌘1-9, and the ⌘K sub-menu.
/// A value type: every key returns a new state.
public struct PaletteNav: Equatable {
    public let rows: [PaletteItem]
    public let selected: Int
    public let subMenu: [PaletteSubAction]?
    public let subSelected: Int

    public init(rows: [PaletteItem], selected: Int = 0, subMenu: [PaletteSubAction]? = nil, subSelected: Int = 0) {
        self.rows = rows
        self.selected = rows.isEmpty ? 0 : min(max(0, selected), rows.count - 1)
        self.subMenu = subMenu
        self.subSelected = subSelected
    }

    public var selectedItem: PaletteItem? { rows.indices.contains(selected) ? rows[selected] : nil }

    public var selectedSubAction: PaletteSubAction? {
        guard let subMenu, subMenu.indices.contains(subSelected) else { return nil }
        return subMenu[subSelected]
    }

    /// ↑/↓, wrapping. Inside the sub-menu it moves that menu's selection instead.
    public func moved(by step: Int) -> PaletteNav {
        if let subMenu {
            guard !subMenu.isEmpty else { return self }
            return PaletteNav(rows: rows, selected: selected, subMenu: subMenu,
                              subSelected: ((subSelected + step) % subMenu.count + subMenu.count) % subMenu.count)
        }
        guard !rows.isEmpty else { return self }
        return PaletteNav(rows: rows, selected: ((selected + step) % rows.count + rows.count) % rows.count)
    }

    public func selecting(_ index: Int) -> PaletteNav { PaletteNav(rows: rows, selected: index, subMenu: subMenu, subSelected: subSelected) }

    /// ⌘1…⌘9: the row at that position, one-based.
    public func quickPick(_ number: Int) -> PaletteItem? {
        guard (1...9).contains(number), rows.indices.contains(number - 1) else { return nil }
        return rows[number - 1]
    }

    /// Tab: the first row of the next section, wrapping to the first section.
    public func cycledSection(backward: Bool = false) -> PaletteNav {
        guard subMenu == nil, selectedItem != nil else { return self }
        var starts: [Int] = []
        for (index, row) in rows.enumerated() where index == 0 || rows[index - 1].section != row.section { starts.append(index) }
        guard starts.count > 1 else { return self }
        let here = starts.lastIndex(where: { $0 <= selected }) ?? 0
        let next = (here + (backward ? starts.count - 1 : 1)) % starts.count
        return PaletteNav(rows: rows, selected: starts[next])
    }

    /// New results: keep the same row selected when it is still there, else go back to the top.
    public func replacingRows(_ new: [PaletteItem]) -> PaletteNav {
        let id = selectedItem?.id
        let index = id.flatMap { id in new.firstIndex(where: { $0.id == id }) } ?? 0
        return PaletteNav(rows: new, selected: index)
    }

    public func openingSubMenu() -> PaletteNav {
        guard let item = selectedItem else { return self }
        let actions = PaletteSubActions.for(item)
        return PaletteNav(rows: rows, selected: selected, subMenu: actions.isEmpty ? nil : actions, subSelected: 0)
    }

    public func closingSubMenu() -> PaletteNav { PaletteNav(rows: rows, selected: selected) }
}
