use crate::models::NetworkInterface;
use std::collections::BTreeMap;

pub fn get_interfaces() -> Vec<NetworkInterface> {
    let addrs = match if_addrs::get_if_addrs() {
        Ok(addrs) => addrs,
        Err(_) => return Vec::new(),
    };

    let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for iface in addrs {
        if iface.is_loopback() {
            continue;
        }
        grouped
            .entry(iface.name.clone())
            .or_default()
            .push(iface.addr.ip().to_string());
    }

    grouped
        .into_iter()
        .map(|(name, addresses)| NetworkInterface { name, addresses })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_interfaces_returns_without_error() {
        // get_interfaces() should not panic and should return a valid Vec.
        // The result may be empty in some CI environments with no non-loopback interfaces.
        let _interfaces = get_interfaces();
    }

    #[test]
    fn get_interfaces_excludes_loopback() {
        let interfaces = get_interfaces();
        for iface in &interfaces {
            assert_ne!(iface.name, "lo", "Loopback interface should be excluded");
        }
    }

    #[test]
    fn get_interfaces_have_valid_structure() {
        let interfaces = get_interfaces();
        for iface in &interfaces {
            assert!(!iface.name.is_empty(), "Interface name should not be empty");
            assert!(
                !iface.addresses.is_empty(),
                "Interface '{}' should have at least one address",
                iface.name
            );
            for addr in &iface.addresses {
                assert!(!addr.is_empty(), "Address should not be empty");
            }
        }
    }

    #[test]
    fn get_interfaces_no_duplicate_names() {
        let interfaces = get_interfaces();
        let names: Vec<&str> = interfaces.iter().map(|i| i.name.as_str()).collect();
        let mut unique_names = names.clone();
        unique_names.sort();
        unique_names.dedup();
        assert_eq!(
            names.len(),
            unique_names.len(),
            "Interface names should be unique (grouped by BTreeMap)"
        );
    }
}
