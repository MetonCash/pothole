enum Errors {
    WrongOp = 0xFFFF

    WrongSender = "ERROR_WRONG_SENDER".crc16()
    NotEnoughGas = "ERROR_NOT_ENOUGH_GAS".crc16()
    InvalidWorkchain = "ERROR_INVALID_WORKCHAIN".crc16()
    AlreadyInitialized = "ERROR_ALREADY_INITIALIZED".crc16()
    InvalidSender = "ERROR_INVALID_SENDER".crc16()
    NotInitialized = "ERROR_NOT_INITIALIZED".crc16()
    InvalidAmount = "ERROR_INVALID_AMOUNT".crc16()
    ExpiredOperation = "ERROR_EXPIRED_OPERATION".crc16()
    InvalidParams = "ERROR_INVALID_PARAMS".crc16()
    InvalidOperation = "ERROR_INVALID_OPERATION".crc16()
    InvalidSignature = "INVALID_SIGNATURE".crc16()
    WrongTurn = "WRONG_TURN".crc16()
    InvalidSeqno = "INVALID_SEQNO".crc16()
    InvalidDeploymentId = "INVALID_DEPLOYMENT_ID".crc16()
    Expired = "EXPIRED".crc16()
}
