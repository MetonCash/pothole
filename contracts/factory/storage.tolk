import "@factory/interfaces"

fun FactoryStorage.load(): FactoryStorage {
    return FactoryStorage.fromCell(contract.getData());
}

fun FactoryStorage.save(st: FactoryStorage): void {
    contract.setData(st.toCell());
}
