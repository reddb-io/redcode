//! Deliberately incompatible ABI fixture for the experimental loader test.
use std::ffi::c_char;

#[no_mangle]
pub extern "C" fn redcode_search_abi_version() -> u32 {
    2
}

#[no_mangle]
pub extern "C" fn redcode_search_new(_: *const u8, _: usize) -> *mut u8 {
    std::ptr::null_mut()
}

#[no_mangle]
pub extern "C" fn redcode_search_new_async(_: *const u8, _: usize) -> *mut u8 {
    std::ptr::null_mut()
}

#[no_mangle]
pub extern "C" fn redcode_search_ready(_: *mut u8) -> i32 {
    -1
}

#[no_mangle]
pub extern "C" fn redcode_search_find(_: *mut u8, _: *const u8, _: usize, _: u32, _: usize) -> *mut c_char {
    std::ptr::null_mut()
}

#[no_mangle]
pub extern "C" fn redcode_search_drop(_: *mut u8) {}

#[no_mangle]
pub extern "C" fn redcode_search_free_string(_: *mut c_char) {}
