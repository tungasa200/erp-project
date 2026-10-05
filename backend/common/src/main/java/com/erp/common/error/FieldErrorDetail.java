package com.erp.common.error;

/**
 * Problem Details의 errors[] 항목. code는 기계 판독용(예: PASSWORD_LENGTH), message는 사람이 읽는 설명.
 */
public record FieldErrorDetail(String field, String code, String message) {
}
